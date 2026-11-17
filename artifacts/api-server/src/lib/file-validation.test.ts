import { describe, expect, it } from "vitest";
import { fileMatchesType } from "./file-validation";

const bytes = (...values: number[]) => Buffer.from(values);

describe("uploaded file signatures", () => {
  it("accepts real PDFs, PNGs, JPEGs and WebP images", () => {
    expect(fileMatchesType(Buffer.from("%PDF-1.7\n..."), "application/pdf")).toBe(true);
    expect(fileMatchesType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0), "image/png")).toBe(true);
    expect(fileMatchesType(bytes(0xff, 0xd8, 0xff, 0xe0, 0), "image/jpeg")).toBe(true);
    expect(fileMatchesType(Buffer.from("RIFF\0\0\0\0WEBPVP8 "), "image/webp")).toBe(true);
  });

  it("rejects files whose content doesn't match the declared type", () => {
    expect(fileMatchesType(Buffer.from("<script>alert(1)</script>"), "application/pdf")).toBe(false);
    expect(fileMatchesType(Buffer.from("%PDF-1.7"), "image/png")).toBe(false);
    expect(fileMatchesType(bytes(0xff, 0xd8), "image/jpeg")).toBe(false);
    expect(fileMatchesType(Buffer.from("RIFF\0\0\0\0WAVE"), "image/webp")).toBe(false);
  });

  it("rejects types that aren't allowed at all", () => {
    expect(fileMatchesType(Buffer.from("<svg/>"), "image/svg+xml")).toBe(false);
    expect(fileMatchesType(Buffer.from("hello"), "text/html")).toBe(false);
  });
});
