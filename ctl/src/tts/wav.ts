export interface WavPaddingOptions {
  leadingMs: number;
  trailingMs: number;
}

interface WavInfo {
  bytesPerSecond: number;
  blockAlign: number;
  dataOffset: number;
  dataSize: number;
}

export function padWavSilence(input: ArrayBuffer, options: WavPaddingOptions): ArrayBuffer {
  const bytes = new Uint8Array(input);
  const view = new DataView(input);
  const info = readWavInfo(bytes, view);
  if (!info) return input;

  const leadingBytes = alignBytes(
    Math.round((info.bytesPerSecond * options.leadingMs) / 1000),
    info.blockAlign,
  );
  const trailingBytes = alignBytes(
    Math.round((info.bytesPerSecond * options.trailingMs) / 1000),
    info.blockAlign,
  );
  if (leadingBytes === 0 && trailingBytes === 0) return input;

  const dataStart = info.dataOffset;
  const actualDataSize = Math.min(info.dataSize, bytes.byteLength - info.dataOffset);
  const dataEnd = info.dataOffset + actualDataSize;
  const output = new Uint8Array(bytes.byteLength + leadingBytes + trailingBytes);

  output.set(bytes.slice(0, dataStart), 0);
  output.set(bytes.slice(dataStart, dataEnd), dataStart + leadingBytes);
  output.set(bytes.slice(dataEnd), dataEnd + leadingBytes + trailingBytes);

  const outputView = new DataView(output.buffer);
  outputView.setUint32(4, output.byteLength - 8, true);
  outputView.setUint32(info.dataOffset - 4, actualDataSize + leadingBytes + trailingBytes, true);
  return output.buffer;
}

function readWavInfo(bytes: Uint8Array, view: DataView): WavInfo | undefined {
  if (
    bytes.byteLength < 44 ||
    readAscii(bytes, 0, 4) !== "RIFF" ||
    readAscii(bytes, 8, 4) !== "WAVE"
  ) {
    return undefined;
  }

  let offset = 12;
  let bytesPerSecond = 0;
  let blockAlign = 0;

  while (offset + 8 <= bytes.byteLength) {
    const chunkId = readAscii(bytes, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const chunkDataOffset = offset + 8;

    if (chunkId === "fmt ") {
      if (chunkSize < 16) return undefined;
      bytesPerSecond = view.getUint32(chunkDataOffset + 8, true);
      blockAlign = view.getUint16(chunkDataOffset + 12, true);
    }

    if (chunkId === "data") {
      if (!bytesPerSecond || !blockAlign) return undefined;
      return {
        bytesPerSecond,
        blockAlign,
        dataOffset: chunkDataOffset,
        dataSize: chunkSize,
      };
    }

    offset = chunkDataOffset + chunkSize + (chunkSize % 2);
  }

  return undefined;
}

function alignBytes(bytes: number, blockAlign: number): number {
  if (bytes <= 0) return 0;
  return bytes - (bytes % blockAlign);
}

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}
