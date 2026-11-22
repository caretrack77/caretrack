import { describe, expect, it } from "vitest";
import {
  answerFromAssistantRecords,
  assistantRecordIntent,
  type AssistantDoseRecord,
} from "./assistant-record-answers";

describe("assistant record answers", () => {
  it.each([
    ["When is my next dose?", "next-dose"],
    ["Kailan ang susunod kong gamot?", "next-dose"],
    ["What should I do if I missed a dose?", "missed-dose"],
    ["What medicines am I taking?", "medications"],
    ["Kailan ang next check-up ko?", "appointment"],
    ["How am I doing?", "progress"],
  ] as const)("routes %s to %s records", (question, intent) => {
    expect(assistantRecordIntent(question)).toBe(intent);
  });

  it("does not turn a medication-safety question into a medication-list answer", () => {
    expect(assistantRecordIntent("Can I take my medicine with alcohol?")).toBeNull();
  });

  it("answers dose timing from the supplied CareTrack dose record", () => {
    const dose: AssistantDoseRecord = {
      medicationName: "Example medicine",
      dosage: "1 tablet",
      scheduledTime: new Date("2026-11-23T01:00:00.000Z"),
    };

    expect(answerFromAssistantRecords("When is my next dose?", "next-dose", [dose]))
      .toContain("Example medicine (1 tablet)");
    expect(answerFromAssistantRecords("When is my next dose?", "next-dose", [dose]))
      .toContain("9:00 AM Manila time");
  });

  it("does not invent a dose when none is scheduled", () => {
    expect(answerFromAssistantRecords("Kailan ang susunod kong gamot?", "next-dose", []))
      .toContain("Walang naka-iskedyul");
  });

  it("uses the missed-dose log and gives safe next-step guidance", () => {
    const answer = answerFromAssistantRecords("What should I do if I missed a dose?", "missed-dose", [{
      medicationName: "Example medicine",
      dosage: "1 tablet",
      scheduledTime: new Date("2026-11-23T01:00:00.000Z"),
    }]);

    expect(answer).toContain("CareTrack records Example medicine");
    expect(answer).toContain("do not double a dose");
  });

  it("answers with the actual weekly dose counts", () => {
    expect(answerFromAssistantRecords("How am I doing?", "progress", [
      { status: "taken" },
      { status: "missed" },
      { status: "scheduled" },
    ])).toContain("1 of 2 logged doses as taken and 1 as missed");
  });
});
