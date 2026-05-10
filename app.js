/**
 * LearnFlow Phase 2B.2: Unified Source Block Pipeline
 * VERSION: SOURCE BLOCK PIPELINE v0.4.5-UNIFIED
 */

const { useState } = React;

const APP_VERSION = "VERSION: SOURCE BLOCK PIPELINE v0.4.5-UNIFIED";

function App() {
  const [text, setText] = useState("");
  const [blocks, setBlocks] = useState([]);
  const [globalTopic, setGlobalTopic] = useState("Chemistry");
  const [mode, setMode] = useState(null);
  const [index, setIndex] = useState(0);

  const normalize = (l) => String(l || "").replace(/\s+/g, " ").trim();

  function cleanText(value) {
    return String(value || "")
      .replace(/\r/g, "")
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/\u00a0/g, " ")
      .trim();
  }

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

  function extractAnswerKey(text) {
    const lines = text.split("\n");
    const clean = [];
    const key = {};
    let inKey = false;

    for (const line of lines) {
      const l = normalize(line).toLowerCase();

      if (!inKey && (l === "answer key" || l === "answers" || l.startsWith("key:"))) {
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

  function isHeader(line) {
    const clean = normalize(line);
    return (/^part\s+/i.test(clean) || /^section\s+/i.test(clean));
  }

  function isLikelyAnswerGridStart(lines, startIndex) {
    const window = lines.slice(startIndex, startIndex + 15).map(normalize);
    if (window.length < 5) return false;

    const shortLines = window.filter(l => l.length <= 4).length;
    const scantronPatterns = window.filter(l => /^\d{1,3}[.)]?$/.test(l) || /^[A-E]$/i.test(l)).length;
    const hasSentences = window.some(l => l.length > 20 && /\s/.test(l));

    return (scantronPatterns >= 3 && shortLines >= window.length * 0.7 && !hasSentences);
  }

  function isQuestionStart(lines, i, started) {
    const line = lines[i];
    if (!/^\s*\d{1,3}[.)]\s+\S+/.test(line)) return false;
    if (isLikelyAnswerGridStart(lines, i)) return false;

    if (started) return true;

    const clean = normalize(line);
    const nearby = lines.slice(i, i + 6).map(normalize).join(" ");

    return (
      /\?/.test(clean) ||
      /\b(which|what|calculate|determine|identify|explain|select|write|complete|classify|use|match)\b/i.test(clean) ||
      /_{3,}|☐/.test(clean) ||
      /(?<=^|\s)[A-E][.)](?=\s|$)/.test(nearby)
    );
  }

  function detectType(raw, choiceCount) {
    const lower = raw.toLowerCase();

    if (/graph|figure|diagram|image|segment|point|heating curve|cooling curve/i.test(lower)) return "VISUAL_REQUIRED";
    if (/\bselect\s+(all|multiple|two|three)\b/i.test(lower)) return "MULTI_SELECT";
    if (/drag|move|blank|_{3,}|☐/i.test(lower)) return "INTERACTIVE";
    if (/matching|column a|column b/i.test(lower)) return "MATCHING";

    return choiceCount === 0 ? "FREE_RESPONSE" : "MULTIPLE_CHOICE";
  }

  function harvest() {
    const { cleaned, answerKey } = extractAnswerKey(cleanText(text));
    const allLines = cleaned.split("\n").map(l => l.trim()).filter(Boolean);

    const groups = [];
    let current = null;
    let started = false;

    for (let i = 0; i < allLines.length; i++) {
      const line = allLines[i];

      if (isLikelyAnswerGridStart(allLines, i)) break;

      const newQ = isQuestionStart(allLines, i, started);
      const header = isHeader(line);

      if (newQ || header) {
        if (current) groups.push(current);
        current = newQ ? [line] : null;
        if (newQ) started = true;
      } else if (current) {
        current.push(line);
      }
    }

    if (current) groups.push(current);

    const seen = new Set();

    const processed = groups.map(lines => {
      const raw = lines.join("\n");
      const num = raw.match(/^\d+/)?.[0] || "?";
      const duplicate = seen.has(num);
      seen.add(num);

      const choiceCount = [...raw.matchAll(/(?<=^|\s)[A-E][.)](?=\s|$)/g)].length;
      const type = detectType(raw, choiceCount);

      return {
        sourceNumber: num,
        detectedType: type,
        status: duplicate ? "DUPLICATE" : (type === "VISUAL_REQUIRED" ? "NEEDS_GRAPHIC" : "READY_TO_MIRROR"),
        rawText: raw,
        mirrorPayload: {
          intent: "Mirror assessment item",
          topicHint: globalTopic,
          source: raw,
          originalNumber: num,
          originalType: type,
          answerHint: answerKey[num] || null
        }
      };
    });

    setBlocks(processed);
    setMode("Dashboard");
    setIndex(0);
  }

  const active = blocks[index];

  return React.createElement("div", { style: { padding: "40px", maxWidth: "1000px", margin: "auto" } },

    React.createElement("h1", null, "LearnFlow Pipeline"),
    React.createElement("p", null, APP_VERSION),

    !mode && React.createElement("div", null,
      React.createElement("input", { value: globalTopic, onChange: e => setGlobalTopic(e.target.value) }),
      React.createElement("input", { type: "file", onChange: handleFileUpload }),
      React.createElement("textarea", { value: text, onChange: e => setText(e.target.value) }),
      React.createElement("button", { onClick: harvest }, "Harvest Source")
    ),

    mode === "Dashboard" && React.createElement("div", null,
      blocks.map((b, i) =>
        React.createElement("div", { key: i },
          `Q${b.sourceNumber} | ${b.detectedType} | ${b.status}`
        )
      )
    ),

    mode === "Review" && active && React.createElement("div", null,
      React.createElement("pre", null, active.rawText),
      React.createElement("pre", null, JSON.stringify(active.mirrorPayload, null, 2))
    )
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  React.createElement(App)
);
