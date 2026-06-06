import Image from "next/image";

export function AlfredIcon() {
  return (
    <Image
      src="/alfred-logo.svg"
      alt=""
      width={40}
      height={40}
      className="alfred-icon"
      aria-hidden="true"
      priority
    />
  );
}
