// Runs the Android Gradle wrapper on any OS: `node scripts/gradle.mjs assembleRelease`.
// pnpm runs package scripts without the current folder on PATH, so a bare `gradlew` is not
// found on Windows; this calls android/gradlew.bat (Windows) or android/gradlew directly.
// When JAVA_HOME isn't set, it uses the JDK bundled with Android Studio if it can find one.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const androidDir = fileURLToPath(new URL("../android/", import.meta.url));
const windows = process.platform === "win32";
const wrapper = path.join(androidDir, windows ? "gradlew.bat" : "gradlew");

const env = { ...process.env };
if (!env.JAVA_HOME) {
  const candidates = windows
    ? [
        "C:\\Program Files\\Android\\Android Studio\\jbr",
        path.join(env.LOCALAPPDATA ?? "", "Programs", "Android Studio", "jbr"),
      ]
    : process.platform === "darwin"
      ? ["/Applications/Android Studio.app/Contents/jbr/Contents/Home"]
      : ["/opt/android-studio/jbr", path.join(homedir(), "android-studio", "jbr")];
  const found = candidates.find((dir) => existsSync(path.join(dir, "bin", windows ? "java.exe" : "java")));
  if (found) {
    env.JAVA_HOME = found;
    console.log(`Using Android Studio's Java: ${found}`);
  }
}

const args = process.argv.slice(2);
// A .bat file must be started through cmd.exe; quoting keeps paths with spaces intact.
const result = windows
  ? spawnSync("cmd.exe", ["/d", "/s", "/c", `"${wrapper}" ${args.join(" ")}`], { cwd: androidDir, env, stdio: "inherit", windowsVerbatimArguments: true })
  : spawnSync(wrapper, args, { cwd: androidDir, env, stdio: "inherit" });
if (result.error) {
  console.error(`Could not start Gradle: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
