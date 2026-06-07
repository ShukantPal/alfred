"use client";

import Image from "next/image";
import { Fragment } from "react";
import { AppTabIcon } from "@/components/AppTabIcon";
import { promptSuggestions } from "@/lib/apps";

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

      <div className="alfred-landing__suggestions">
        <p className="alfred-landing__suggestions-label">Try saying</p>
        <ul className="suggestion-list">
          {promptSuggestions.map((suggestion) => {
            const [before, after] = suggestion.prompt.split("{product}");
            return (
              <li key={suggestion.id} className="suggestion-chip">
                <span className="suggestion-chip__quote">&ldquo;</span>
                <span className="suggestion-chip__text">
                  {before}
                  <span className="suggestion-chip__product">
                    <AppTabIcon icon={suggestion.icon} />
                    <span>{suggestion.product}</span>
                  </span>
                  {after ? <Fragment>{after}</Fragment> : null}
                </span>
                <span className="suggestion-chip__quote">&rdquo;</span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
