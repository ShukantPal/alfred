"use client";

import { useMeetingNotes } from "@/components/MeetingNotesProvider";
import { formatMeetingTime } from "@/lib/formatTime";
import type { MeetingNote } from "@/lib/meetingNotes";

function NoteItem({ note }: { note: MeetingNote }) {
  return (
    <li className="alfred-list-row">
      <p className="alfred-list-row__title">{note.text}</p>
      <p className="alfred-list-row__meta">
        {note.speaker} · {formatMeetingTime(note.capturedAt)}
      </p>
    </li>
  );
}

export function MeetingNotesPanel() {
  const { notes } = useMeetingNotes();

  return (
    <section className="alfred-card meeting-notes-panel">
      <div className="alfred-card__header">
        <h2 className="alfred-card__title">Meeting Notes</h2>
        <span className="alfred-badge">{notes.length} live</span>
      </div>
      <ul className="alfred-card__list">
        {notes.map((note) => (
          <NoteItem key={note.id} note={note} />
        ))}
      </ul>
    </section>
  );
}
