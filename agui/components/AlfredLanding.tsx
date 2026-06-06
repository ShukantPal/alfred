"use client";

import Image from "next/image";

export function AlfredLanding() {
  return (
    <div className="alfred-landing">
      <div className="alfred-landing__hero">
        <Image
          src="/alfred-logo.svg"
          alt=""
          width={72}
          height={72}
          className="alfred-landing__logo"
          priority
        />
        <p className="alfred-landing__eyebrow">To activate, say</p>
        <h1 className="alfred-landing__title">Hey, Alfred</h1>
        <p className="alfred-landing__copy">
          Alfred is in this meeting — transcribing live, capturing notes on the
          left, and tracking action items as they come up.
        </p>
      </div>

      <ul className="alfred-landing__tips">
        <li>
          <strong>Hello Alfred</strong> — wake Alfred and ask a question
        </li>
        <li>
          <strong>Start screenshare</strong> — show this workspace in the call
        </li>
        <li>
          Switch tabs above to open Slack, Docs, Slides, or Sheets
        </li>
      </ul>
    </div>
  );
}
