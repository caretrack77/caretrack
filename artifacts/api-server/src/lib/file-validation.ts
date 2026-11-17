/**
 * Checks an uploaded file's first bytes against its declared type, so a renamed file (for
 * example a script saved as "result.pdf") can't be stored and later served as a document.
 */
export function fileMatchesType(data: Buffer, mimeType: string): boolean {
  const ascii = (start: number, end: number) => data.subarray(start, end).toString("latin1");
  switch (mimeType) {
    case "application/pdf":
      return ascii(0, 5) === "%PDF-";
    case "image/png":
      return data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case "image/jpeg":
      return data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
    case "image/webp":
      return ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
    default:
      return false;
  }
}
