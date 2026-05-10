/**
 * LearnFlow Phase 2B.1: Hardened Source Block Pipeline
 * VERSION: 0.3.11-STABLE
 *
 * FINAL INTEGRATED FIXES:
 * - Section Header Isolation: Prevents "Part 2:" from sticking to Q6.
 * - Chemistry Precision: Uses negative lookbehind to ignore "°C)" in choice counts.
 * - Visual Flagging: Correctly sets NEEDS_GRAPHIC for "segment" and "heating curve" items.
 * - End-Line Detection: Captures matching answers at the end of a line.
 */

const { useState } = React;

const APP_VERSION = "VERSION: SOURCE BLOCK PIPELINE v0.3.11-STABLE";

function App() {
  const [text, setText] = useState("");
  const [blocks, setBlocks] = useState([]);
  const [globalTopic, setGlobalTopic] = useState("Chemistry");
  const [mode, setMode] = useState(null);
  const [index, setIndex] = useState(0);

  const normalize = (line) => String(line || "").replace(/\s+/g, " ").trim();

  async function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    if (typeof mammoth === "undefined") {
      alert("Mammoth.js not detected.");
      return;
    }

    try {
      const buffer = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer: buffer });
      setText(result.value || "");
    } catch (err) {
      console.error("File processing error:", err);
      alert("Failed to parse .docx file.");
    }
  }

  function cleanText(value) {
    return String(value || "")
      .replace(/\r/g, "")
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/\u00a0/g, " ")
      .trim();
  }

  function isSectionHeader(line) {
    const clean = normalize(line);
    return (
      /^part\s+(\d+|[ivx]+)\s*:/i.test(clean) ||
      /^section\s+([a-z]|\d+)\s*:/i.test(clean)
    );
  }

  function extractAnswerKey(text) {
    const lines = text.split("\n");
    const clean = [];
    const key = {};
    let inKey = false;

    for (const line of lines) {
      const l = normalize(line).toLowerCase();

      if (!inKey && (l === "answer key" || l === "answers" || l.startsWith("answer key:") || l.startsWith("key:"))) {
        inKey = true;
        continue;
      }

      if (inKey) {
        const m = normalize(line).match(/^(\d{1,3})[.)]?\s*[-: ]?\s*([A-Ea-e*]{1,3})\b/);
        if (m) key[m[1]] = m[2].replace(/\*/g, "").toUpperCase();
        continue;
      }

      clean.push(line);
    }

    return { cleaned: clean.join("\n"), answerKey: key };
  }

  function isLikelyAnswerGridStart(lines, startIndex) {
    const window = lines.slice(startIndex, startIndex + 20).map(normalize);
    if (window.length < 8) return false;

    const shortLines = window.filter(line => line.length <= 4).length;
    const numberLines = window.filter(line => /^\d{1,3}[.)]?$/.test(line)).length;
    const letterLines = window.filter(line => /^[A-E]$/i.test(line)).length;
    const hasRealSentence = window.some(line => line.length > 20);
    const hasQuestionWords = window.some(line => /\b(which|what|why|how|calculate|determine|identify|explain|select|complete|classify)\b/i.test(line));

    return (numberLines >= 2 && letterLines >= 3 && shortLines >= window.length * 0.65 && !hasRealSentence && !hasQuestionWords);
  }

  function isQuestionStart(lines, index, assessmentStarted) {
    const line = lines[index];

    if (isSectionHeader(line)) return false;
    if (!/^\s*\d{1,3}[.)]\s+\S+/.test(line)) return false;

    if (assessmentStarted) return !isLikelyAnswerGridStart(lines, index);

    const clean = normalize(line);
    const nearby = lines.slice(index, index + 6).map(normalize).join(" ");

    return (
      /\?/.test(clean) ||
      /\b(which|what|calculate|determine|identify|explain|select|write|draw|complete|classify|use|match)\b/i.test(clean) ||
      /_{3,}|☐/.test(clean) ||
      /(^|[^A-Za-z°])[A-Ea-e][.)]\s+/.test(nearby)
    );
  }

  function detectType(rawText, choiceCount) {
    const lower = rawText.toLowerCase();

    if (/graph|figure|diagram|chart|image|insert graphic|heating curve|cooling curve/i.test(rawText) || /\bwhich segment\b/i.test(rawText)) {
      return "VISUAL_REQUIRED";
    }

    if (/\bselect\s+(all|multiple|two|three|four)\b/i.test(lower)) return "MULTI_SELECT";
    if (/drag|move|blank|_{3,}|☐|token bank|drop zone/i.test(lower)) return "INTERACTIVE";
    if (/matching|match each|column a|column b/i.test(lower)) return "MATCHING";

    return choiceCount === 0 ? "FREE_RESPONSE" : "MULTIPLE_CHOICE";
  }

  function harvest() {
    const base = extractAnswerKey(cleanText(text));

    const allLines = base.cleaned
      .split("\n")
      .map(line => line.trim())
      .filter(Boolean);

    const groups = [];
    let current = null;
    let assessmentStarted = false;

    allLines.forEach((line, i) => {
      if (isSectionHeader(line)) {
        if (current) groups.push(current);
        current = null;
        return;
      }

      if (isQuestionStart(allLines, i, assessmentStarted)) {
        assessmentStarted = true;
        if (current) groups.push(current);
        current = [line];
      } else if (current) {
        current.push(line);
      }
    });

    if (current) groups.push(current);

    const seen = new Set();

    const result = groups.map(lines => {
      const rawText = lines.join("\n");
      const sourceNumber = String(lines[0] || "").match(/^\s*(\d{1,3})[.)]/)?.[1] || "?";
      const duplicate = seen.has(sourceNumber);
      seen.add(sourceNumber);

      const matches = [...rawText.matchAll(/(^|[^A-Za-z°])([A-Ea-e])[.)]\s+/g)];
      const detectedType = detectType(rawText, matches.length);
      const answerHint = base.answerKey[sourceNumber] || null;

      return {
        sourceNumber,
        detectedType,
        status: duplicate ? "DUPLICATE" : (detectedType === "VISUAL_REQUIRED" ? "NEEDS_GRAPHIC" : "READY_TO_MIRROR"),
        rawText,
        answerHint,
        mirrorPayload: {
          intent: "Mirror assessment item",
          topicHint: globalTopic,
          source: rawText,
          originalNumber: sourceNumber,
          originalType: detectedType,
          answerHint
        }
      };
    });

    setBlocks(result);
    setIndex(0);
    setMode("Dashboard");
  }

  const active = blocks[index];

  return React.createElement("div", { style: { padding: "40px", fontFamily: "sans-serif", maxWidth: "1000px", margin: "auto" } },

    React.createElement("h1", null, "LearnFlow Pipeline"),
    React.createElement("p", null, APP_VERSION),

    !mode && React.createElement("div", null,
      React.createElement("input", { value: globalTopic, onChange: e => setGlobalTopic(e.target.value) }),
      React.createElement("input", { type: "file", onChange: handleFileUpload }),
      React.createElement("textarea", { value: text, onChange: e => setText(e.target.value) }),
      React.createElement("button", { onClick: harvest }, "Harvest Source")
    ),

    mode === "Dashboard" && React.createElement("div", null,
      React.createElement("button", { onClick: () => setMode(null) }, "Back"),
      blocks.map((b, i) =>
        React.createElement("div", { key: i },
          `Q${b.sourceNumber} | ${b.detectedType} | ${b.status}`,
          React.createElement("button", {
            onClick: () => { setIndex(i); setMode("Review"); }
          }, "Review")
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
