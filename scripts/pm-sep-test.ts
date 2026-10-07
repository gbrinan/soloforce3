import { configurePathMatcher, matchesAllowList } from "../src/mcp/path-matcher.js";
const target = "C:/mycrew/mycrew-program/src/agent.ts";
configurePathMatcher({ bases: ["C:\mycrew\mycrew-program"], projectsDir: "" });
console.log("[역슬래시 base] '/**':", matchesAllowList(target, ["/**"]));
configurePathMatcher({ bases: ["C:/mycrew/mycrew-program"], projectsDir: "" });
console.log("[슬래시 base]   '/**':", matchesAllowList(target, ["/**"]));
