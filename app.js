/**
 * LearnFlow Phase 2B.1: Hardened Source Block Pipeline
 * VERSION: 0.3.9-STABLE
 *
 * FINAL FIX:
 * - Strong Scantron Grid Killer (eliminates repeated Q1–20 blocks)
 * - Prevents false positives from real MC questions
 * - Maintains Source Block Pipeline integrity
 */

const { useState } = React;

const APP_VERSION = "VERSION: SOURCE BLOCK PIPELINE v0.3.9-STABLE";

function App() {
  const [text, setText] = useState("");
  const [blocks, setBlocks] = useState([]);
  const [globalTopic, setGlobalTopic] = useState("Chemistry");
  const [mode, setMode] = useState(null);
  const [index, setIndex] = useState(0);

  const normalize = (l) => String(l || "").replace(/\s+/g, " ").trim();

  // ===============================
  // FILE LOAD
  // ===============================
  async function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    if (typeof mammoth === "undefined") {
      alert("Mammoth.js not detected.");
      return;
    }

    const buffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer: buffer });
    setText(result.value || "");
  }

  // ===============================
  // CLEANING
  // ===============================
  function cleanText(value) {
    return String(value || "")
      .replace(/\r/g, "")
      .replace(/\u00a0/g, " ")
      .trim();
  }

  function extractAnswerKey(text) {
    const lines = text.split("\n");
    const clean = [];
    const key = {};
    let inKey = false;

    for (let line of lines) {
      const l = normalize(line).toLowerCase();

      if (!inKey && (l.includes("answer key") || l === "answers")) {
        inKey = true;
        continue;
      }

      if (inKey) {
        const m = line.match(/^(\d+).*?([A-E])\b/i);
        if (m) key[m[1]] = m[2].toUpperCase();
        continue;
      }

      clean.push(line);
    }

    return { cleaned: clean.join("\n"), answerKey: key };
  }

  // ===============================
  // 🚨 STRONG GRID DETECTION
  // ===============================
  function isLikelyAnswerGridStart(lines, startIndex) {
    const window = lines.slice(startIndex, startIndex + 20).map(normalize);

    if (window.length < 8) return false;

    // Count short meaningless lines
    const shortLines = window.filter(l => l.length <= 4).length;

    // Count real sentences
    const hasRealSentence = window.some(l => l.length > 20);

    // Detect repeated numbering pattern
    const numberRepeats = window.filter(l => /^\d{1,3}[.)]?$/.test(l)).length;

    // Detect heavy A/B/C/D presence
    const letterLines = window.filter(l => /^[A-E]$/.test(l)).length;

    // 🚨 FINAL DECISION
    return (
      numberRepeats >= 3 &&
      letterLines >= 3 &&
      shortLines > window.length * 0.7 &&
      !hasRealSentence
    );
  }

  function removeTrailingAnswerGrid(lines) {
    const cleaned = [];

    for (let i = 0; i < lines.length; i++) {
      if (isLikelyAnswerGridStart(lines, i)) {
        console.log("🧹 Removed Scantron Grid at line:", i);
        break;
      }
      cleaned.push(lines[i]);
    }

    return cleaned;
  }

  // ===============================
  // QUESTION DETECTION
  // ===============================
  function isQuestionStart(lines, i, started) {
    const line = lines[i];

    if (!/^\d{1,3}[.)]\s+\S+/.test(line)) return false;

    if (started) return !isLikelyAnswerGridStart(lines, i);

    const clean = normalize(line);
    const nearby = lines.slice(i, i + 5).join(" ");

    return (
      /\?/.test(clean) ||
      /\b(which|what|calculate|identify|select|explain)\b/i.test(clean) ||
      /_{3,}|☐/.test(clean) ||
      /[A-E][.)]/.test(nearby)
    );
  }

  function detectType(raw, count) {
    if (/graph|figure|diagram|image/i.test(raw)) return "VISUAL_REQUIRED";
    if (/\bselect\s+(two|all|multiple)\b/i.test(raw)) return "MULTI_SELECT";
    if (/_{3,}|☐/.test(raw)) return "INTERACTIVE";
    return count === 0 ? "FREE_RESPONSE" : "MULTIPLE_CHOICE";
  }

  // ===============================
  // PIPELINE
  // ===============================
  function harvest() {
    const base = extractAnswerKey(cleanText(text));
    const rawLines = removeTrailingAnswerGrid(
      base.cleaned.split("\n").map(l => l.trim()).filter(Boolean)
    );

    const groups = [];
    let current = null;
    let started = false;

    rawLines.forEach((line, i) => {
      if (isQuestionStart(rawLines, i, started)) {
        started = true;
        if (current) groups.push(current);
        current = [line];
      } else if (current) {
        current.push(line);
      }
    });

    if (current) groups.push(current);

    const seen = new Set();

    const result = groups.map(lines => {
      const raw = lines.join("\n");
      const num = lines[0].match(/^(\d+)/)?.[1] || "?";

      const duplicate = seen.has(num);
      seen.add(num);

      const choiceCount = [...raw.matchAll(/[A-E][.)]/g)].length;
      const type = detectType(raw, choiceCount);

      return {
        sourceNumber: num,
        detectedType: type,
        status: duplicate ? "DUPLICATE" : "READY_TO_MIRROR",
        rawText: raw,
        mirrorPayload: {
          topicHint: globalTopic,
          source: raw,
          originalNumber: num
        }
      };
    });

    setBlocks(result);
    setIndex(0);
    setMode("Dashboard");
  }

  // ===============================
  // UI
  // ===============================
  const active = blocks[index];

  return React.createElement("div", { style: { padding: 40 } },

    React.createElement("h1", null, "LearnFlow"),
    React.createElement("p", null, APP_VERSION),

    !mode && React.createElement("div", null,
      React.createElement("textarea", {
        value: text,
        onChange: e => setText(e.target.value),
        style: { width: "100%", height: 300 }
      }),
      React.createElement("button", { onClick: harvest }, "Analyze")
    ),

    mode === "Dashboard" && React.createElement("div", null,
      blocks.map((b, i) =>
        React.createElement("div", { key: i },
          `Q${b.sourceNumber} | ${b.detectedType} | ${b.status}`,
          React.createElement("button", {
            onClick: () => { setIndex(i); setMode("Review"); }
          }, "Inspect")
        )
      )
    ),

    mode === "Review" && active && React.createElement("div", null,
      React.createElement("button", { onClick: () => setMode("Dashboard") }, "Back"),
      React.createElement("pre", null, active.rawText),
      React.createElement("pre", null, JSON.stringify(active.mirrorPayload, null, 2))
    )
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  React.createElement(App)
);
