# CopilotKit ↔ Recall.ai integration notes

_Author: Shukant · last updated before I went OOO · ping me on Slack if something here is stale_

Writing this down because three people have now asked me how the meeting surface
actually works, and I don't want to explain it live again. This is the whole thing
end to end. It's longer than it needs to be but I'd rather over-document than have
someone guess and break the timing logic.

## TL;DR

Recall is how Alfred gets **into** the meeting and how we get audio out of it.
CopilotKit is how we render what Alfred is doing **back onto a screen** the meeting
can actually see. They do **not** talk to each other directly — the agent layer sits
in the middle and is the only thing that touches both. If you remember one sentence:
**Recall is the ears and the projector, CopilotKit is what gets projected, the agent
layer is the brain wiring them together.**

## Why it's built this way

The obvious thing would be to have Recall's bot also drive the UI directly. Don't.
Recall's bot is a black box that joins the call — it's good at media in/out and bad at
being an app. CopilotKit is the opposite: it's a real frontend that can render agent
state beautifully but has no idea a meeting exists. So we keep them decoupled and let
the agent layer broker between them. This also means if we swap Recall for another
meeting provider later, only the `ctl/` layer changes — `agent/` and the CopilotKit
frontend don't care.

## The actual data flow

End to end, one round trip looks like this:

1. **Recall joins the meeting** as a bot participant. We kick this off from `ctl/`
   with the meeting URL. Recall gives us back a bot ID and a websocket for the media
   stream.
2. **Audio comes in** off that Recall stream. We pipe it through streaming STT so we
   get a live partial transcript, not a transcribe-after-silence dump. Latency here
   matters — if STT lags, Alfred feels slow even if the model is instant.
3. **Address detection.** Not every sentence is for Alfred. `ctl/` decides whether a
   given utterance is actually directed at the agent (wake word "Hey Alfred" + a bit of
   heuristic) and only forwards those. Everything else still gets logged to memory but
   doesn't trigger a turn — otherwise Alfred talks over people, which looked insane the
   first time we tested it.
4. **Forward to the agent** over the websocket as a `sendMessage` frame
   (`{ correlationId, meetingId, speaker, text, addressedToAgent: true }`). The
   correlationId is what lets us match the streamed response back to this specific ask.
5. **Agent does its thing.** Orchestrator splits the question, subagents go pull from
   docs / people / memory. As it works it emits two kinds of outbound frames:
   `agentMessage` (streaming tokens of the actual answer) and `agentTrace`
   (start/finish events for each subagent node).
6. **CopilotKit renders the work live.** This is the part people don't expect. Instead
   of only speaking the answer back, the CopilotKit frontend is subscribed to the
   agent's outbound stream. As `agentMessage` and `agentTrace` frames arrive, CopilotKit
   renders them as generative UI — the notes, the source it pulled (the literal Slack
   message or doc), the task it created, and the summarized/visualized version of a long
   document. CopilotKit's AG-UI protocol is doing the heavy lifting here; we're basically
   mapping our frame types onto AG-UI events.
7. **Screen-share the CopilotKit surface back through Recall.** Recall can present a
   browser/screen into the meeting. So we point it at the CopilotKit surface and share
   that. Net effect: the whole meeting sees Alfred's reasoning and sources rendered live,
   not just hears a voice.
8. **TTS for the spoken answer** goes back out the Recall audio channel in parallel with
   the screen-share, so Alfred talks and shows at the same time.

So the loop is: **Recall (audio in) → STT → agent → CopilotKit (render) → Recall
(screen-share out)**, with TTS riding the audio channel back.

## The part that actually took time: mount/share ordering

The bug that ate most of a day: if you trigger the Recall screen-share before CopilotKit
has actually mounted and rendered the surface, the meeting sees a blank/white screen for
a beat, then it pops in. Looks broken even though nothing is.

Fix: the agent layer sends CopilotKit an explicit "mount the surface for this
correlationId" signal **first**, CopilotKit acks once the component tree is rendered and
painted (not just mounted — we wait a frame), and only **then** does `ctl/` tell Recall
to start sharing. It's a tiny handshake but without it the demo looks janky. If you're
debugging a blank share, this ordering is the first thing to check.

Second gotcha in the same area: CopilotKit's stream subscription has to be open before
the agent starts emitting, or you drop the first few `agentTrace` frames and the trace
panel looks like it's missing the first subagent. We open the subscription on session
`open`, not on first message.

## Frame mapping (CopilotKit side)

Rough mapping we settled on, in case you're extending the UI:

- `agentMessage` (streaming) → the live answer text panel. Append deltas, don't re-render.
- `agentTrace` start/finish → the "what Alfred is doing" panel — each subagent shows up as
  a node that lights up on start and checks off on finish. This is also basically a mirror
  of what shows in the Weave trace, just user-facing.
- `agentAction` (present/postSlack/createTask) → a card with a confirm button. **Do not**
  auto-execute side effects. The card waits for a human to approve before anything writes
  to Slack/ClickUp. We show the card during the meeting, action fires after.
- document payloads → the visualizer component, which takes a long doc and renders the
  condensed/structured view instead of dumping raw text.

## Things to not touch / known sharp edges

- Don't move address detection into the agent layer. It belongs in `ctl/` next to the
  media stream — the agent shouldn't have to know about wake words.
- The correlationId has to thread all the way through (Recall utterance → agent →
  CopilotKit render). If renders show up under the wrong ask, that's a correlationId leak.
- Keep CopilotKit subscribed at session scope, not message scope (see gotcha above).
- The mount-before-share handshake is load-bearing for the demo. If someone "simplifies"
  it away, the blank-screen flash comes back.

If any of this is wrong because we changed it after I left, trust the code over this doc,
but the mount/share ordering and the no-direct-connection rule are the two things I'd be
surprised to see change.

— Shukant