/**
 * LearnFlow Phase 3: Single-Question AI Mirroring Layer
 * VERSION: SOURCE BLOCK PIPELINE v0.5.2-BETA
 *
 * STATUS:
 * - NEEDS VALIDATION against user-run output.
 *
 * FIXES:
 * - Preserves Source Block Pipeline behavior.
 * - Restores DOCX upload.
 * - Keeps full raw source blocks.
 * - Keeps Scantron/grid kill switch.
 * - Keeps header isolation.
 * - Restores INTERACTIVE detection.
 * - Avoids [object Object] rendering.
 * - Adds working Mirror Prompt Preview.
 * - Resets preview when switching questions.
 */

const { useState, useEffect } = React;

const APP_VERSION = "VERSION: SOURCE BLOCK PIPELINE v0.5.2-BETA";

function App() {
  const [text, setText] = useState("");
  const [blocks, setBlocks] = useState([]);
  const [globalTopic, setGlobalTopic] = useState("Chemistry");
  const [mode, setMode] = useState(null);
  const [index, setIndex] = useState(0);
  const [mirrorOutput, setMirrorOutput] = useState("");

  const normalize = (line) => String(line || "").replace(/\s+/g, " ").trim();

  useEffect(() => {
    setMirrorOutput("");
  }, [index, mode]);

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

    try {
      const buffer = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer: buffer });
      setText(result.value || "");
    } catch (err) {
      console.error("DOCX parse failed:", err);
      alert("DOCX parse failed.");
    }
  }

  function extractAnswerKey(value) {
    const lines = value.split("\n");
    const clean = [];
    const key = {};
    let inKey = false;

    for (const line of lines) {
      const normalized = normalize(line);
      const lower = normalized.toLowerCase();

      if (
        !inKey &&
        (
          lower === "answer key" ||
          lower === "answers" ||
          lower.startsWith("answer key:") ||
          lower.startsWith("key:")
        )
      ) {
        inKey = true;
        continue;
      }

      if (inKey) {
        const match = normalized.match(/^(\d{1,3})[.)]?\s*[-: ]?\s*([A-Ea-e*]{1,3})\b/);
        if (match) {
          key[match[1]] = match[2].replace(/\*/g, "").toUpperCase();
        }
        continue;
      }

      clean.push(line);
    }

    return {
      cleaned: clean.join("\n"),
      answerKey: key
    };
  }

  function isHeader(line) {
    const clean = normalize(line);
    if (/^\s*\d{1,3}[.)]\s+/.test(clean)) return false;

    return (
      /^part\s+(\d+|[ivx]+)\s*:/i.test(clean) ||
      /^section\s+([a-z]|\d+)\s*:/i.test(clean) ||
      /^(multiple choice|matching|free response)\s*:?$/i.test(clean)
    );
  }

  function isLikelyAnswerGridStart(lines, startIndex) {
    const window = lines.slice(startIndex, startIndex + 15).map(normalize);
    if (window.length < 6) return false;

    const shortLines = window.filter(line => line.length <= 4).length;
    const scantronTokens = window.filter(line =>
      /^\d{1,3}[.)]?$/.test(line) || /^[A-E]$/i.test(line)
    ).length;

    const hasSentence = window.some(line => line.length > 20 && /\s/.test(line));
    const hasQuestionWords = window.some(line =>
      /\b(which|what|why|how|calculate|determine|identify|explain|select|complete|classify|use|match)\b/i.test(line)
    );

    return (
      scantronTokens >= 4 &&
      shortLines >= window.length * 0.65 &&
      !hasSentence &&
      !hasQuestionWords
    );
  }

  function detectType(rawText) {
    const lower = rawText.toLowerCase();

    if (
      /\b(graph|figure|diagram|image|chart|heating curve|cooling curve)\b/i.test(lower) ||
      /\bwhich segment\b/i.test(lower)
    ) {
      return "VISUAL_REQUIRED";
    }

    if (/\bselect\s+(all|multiple|two|three|four)\b/i.test(lower)) {
      return "MULTI_SELECT";
    }

    if (/drag|move|blank|_{3,}|☐/.test(lower)) {
      return "INTERACTIVE";
    }

    if (/matching|match each|column a|column b/i.test(lower)) {
      return "MATCHING";
    }

    const choiceCount = [...rawText.matchAll(/(?<=^|\s)[A-Ea-e][.)](?=\s|$)/g)].length;
    return choiceCount === 0 ? "FREE_RESPONSE" : "MULTIPLE_CHOICE";
  }

  function isQuestionStart(lines, i, started) {
    const line = lines[i];
    if (isHeader(line)) return false;
    if (isLikelyAnswerGridStart(allLines, i)) return false; // Scantron Kill Switch
    if (!/^\s*\d{1,3}[.)]\s+\S+/.test(line)) return false;

    if (started) return true;

    const nearby = lines.slice(i, i + 8).map(normalize).join(" ");
    return (
      /\?/.test(nearby) ||
      /\b(which|what|calculate|determine|identify|explain|select|write|complete|classify|use|match)\b/i.test(nearby) ||
      /_{3,}|☐/.test(nearby) ||
      /(?<=^|\s)[A-Ea-e][.)](?=\s|$)/.test(nearby)
    );
  }

  function harvest() {
    const base = extractAnswerKey(cleanText(text));
    const allLines = base.cleaned.split("\n").map(l => l.trim()).filter(Boolean);

    const groups = [];
    let current = null;
    let started = false;

    for (let i = 0; i < allLines.length; i++) {
      const line = allLines[i];
      if (isLikelyAnswerGridStart(allLines, i)) break;

      const newQ = isQuestionStart(allLines, i, started);

      if (isHeader(line)) {
        if (current) groups.push(current);
        current = null;
        continue;
      }

      if (newQ) {
        started = true;
        if (current) groups.push(current);
        current = [line];
      } else if (current) {
        current.push(line);
      }
    }
    if (current) groups.push(current);

    const seen = new Set();
    const processed = groups.map(lines => {
      const raw = lines.join("\n");
      const numMatch = lines[0].match(/^\s*(\d{1,3})[.)]/);
      const num = numMatch ? numMatch[1] : "?";
      const duplicate = seen.has(num);
      seen.add(num);

      const type = detectType(raw);
      const status = duplicate ? "DUPLICATE" : (type === "VISUAL_REQUIRED" ? "NEEDS_GRAPHIC" : "READY_TO_MIRROR");

      return {
        sourceNumber: num,
        detectedType: type,
        status,
        rawText: raw,
        mirrorPayload: {
          intent: "Mirror assessment item",
          topicHint: globalTopic,
          source: raw,
          originalNumber: num,
          originalType: type,
          answerHint: base.answerKey[num] || null,
          constraints: { preserveConcept: true, preserveDOK: true, preserveQuestionType: true }
        }
      };
    });

    setBlocks(processed);
    setIndex(0);
    setMode("Dashboard");
  }

  function generateMirrorPrompt(block) {
    return `ROLE: High School Chemistry Assessment Designer
TASK: Mirror one item.

SOURCE ITEM:
${JSON.stringify(block.mirrorPayload, null, 2)}

RULES:
1. Preserve Question Type: ${block.detectedType}
2. Maintain Depth of Knowledge (DOK).
3. Change surface details (names/values) only.
4. Output JSON: {"mirroredQuestion": "...", "correctAnswer": "..."}`.trim();
  }

  return React.createElement("div", { style: { padding: "40px", fontFamily: "sans-serif", maxWidth: "1100px", margin: "auto" } },
    React.createElement("h1", { style: { color: "#007bff" } }, "LearnFlow Phase 3"),
    React.createElement("p", { style: { fontSize: "0.8rem", color: "#666" } }, APP_VERSION),

    !mode && React.createElement("div", null,
      React.createElement("input", { value: globalTopic, onChange: e => setGlobalTopic(e.target.value), style: { width: "100%", padding: "10px", marginBottom: "10px" }, placeholder: "Topic Hint" }),
      React.createElement("input", { type: "file", accept: ".docx", onChange: handleFileUpload, style: { display: "block", marginBottom: "10px" } }),
      React.createElement("textarea", { value: text, onChange: e => setText(e.target.value), style: { width: "100%", height: "300px", marginBottom: "10px" }, placeholder: "Paste content..." }),
      React.createElement("button", { onClick: harvest, style: { padding: "10px 20px", background: "#007bff", color: "white", border: "none", cursor: "pointer" } }, "Harvest Source")
    ),

    mode === "Dashboard" && React.createElement("div", null,
      React.createElement("button", { onClick: () => setMode(null), style: { marginBottom: "20px" } }, "Back to Editor"),
      blocks.map((b, i) => React.createElement("div", { key: i, style: { padding: "10px", borderBottom: "1px solid #eee", display: "flex", justifyContent: "space-between" } },
        React.createElement("span", null, `Q${b.sourceNumber} | ${b.detectedType} | ${b.status}`),
        React.createElement("button", { onClick: () => { setIndex(i); setMode("Review"); } }, "Review & Mirror")
      ))
    ),

    mode === "Review" && blocks[index] && React.createElement("div", null,
      React.createElement("button", { onClick: () => setMode("Dashboard"), style: { marginBottom: "20px" } }, "Back"),
      React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" } },
        React.createElement("div", null,
          React.createElement("h3", null, "Original Source"),
          React.createElement("pre", { style: { background: "#f8f9fa", padding: "10px", whiteSpace: "pre-wrap", border: "1px solid #ddd" } }, blocks[index].rawText),
          React.createElement("button", { onClick: () => setMirrorOutput(generateMirrorPrompt(blocks[index])), style: { padding: "10px", background: "#28a745", color: "#fff", border: "none" } }, "Generate Prompt")
        ),
        React.createElement("div", null,
          React.createElement("h3", null, "Mirror Prompt Preview"),
          React.createElement("pre", { style: { background: "#f5fff5", padding: "10px", whiteSpace: "pre-wrap", border: "1px solid #b5ddb5", minHeight: "300px" } }, mirrorOutput || "Click Generate...")
        )
      )
    )
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(App));
