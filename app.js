/**
 * LearnFlow Phase 2B.2: Chemistry-Aware Source Block Pipeline
 * VERSION: SOURCE BLOCK PIPELINE v0.4.0-STABLE
 *
 * FINAL INTEGRATED FIXES:
 * 1. Header Isolation: "Part 2:" now stops the previous question immediately.
 * 2. Choice Precision: Regex requires whitespace around A-E to ignore "°C)".
 * 3. Segment Mapping: "segment" and "point" keywords trigger VISUAL_REQUIRED.
 * 4. Architecture: Full browser-compatible React (no JSX).
 */

const { useState } = React;

const APP_VERSION = "VERSION: SOURCE BLOCK PIPELINE v0.4.0-STABLE";

function App() {
  const [text, setText] = useState("");
  const [blocks, setBlocks] = useState([]);
  const [globalTopic, setGlobalTopic] = useState("Chemistry");
  const [mode, setMode] = useState(null);
  const [index, setIndex] = useState(0);

  // ===============================
  // UTILITIES & FILE HANDLING
  // ===============================
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
      alert("Mammoth.js not detected. Ensure the script is in your HTML.");
      return;
    }

    try {
      const buffer = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer: buffer });
      setText(result.value || "");
    } catch (err) {
      console.error(err);
      alert("DOCX parse failed.");
    }
  }

  // ===============================
  // EXTRACTION & DETECTION
  // ===============================
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
    return (
      /^part\s+(\d+|[ivx]+)\s*:/i.test(clean) ||
      /^section\s+([a-z]|\d+)\s*:/i.test(clean)
    );
  }

  function isLikelyAnswerGridStart(lines, startIndex) {
    const window = lines.slice(startIndex, startIndex + 15).map(normalize);
    if (window.length < 6) return false;

    const shortLines = window.filter(l => l.length <= 4).length;
    const numberLines = window.filter(l => /^\d{1,3}[.)]?$/.test(l)).length;
    const letterLines = window.filter(l => /^[A-E]$/i.test(l)).length;
    const hasLongText = window.some(l => l.length > 15);
    const hasQuestionWords = window.some(l =>
      /\b(which|what|why|how|calculate|determine|identify|explain)\b/i.test(l)
    );

    return (numberLines >= 2 && letterLines >= 3 && shortLines >= window.length * 0.6 && !hasLongText && !hasQuestionWords);
  }

  function isQuestionStart(lines, i, started) {
    const line = lines[i];
    if (!/^\s*\d{1,3}[.)]\s+\S+/.test(line)) return false;
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
    if (/graph|figure|diagram|image|segment|point|heating curve|cooling curve/i.test(lower))
      return "VISUAL_REQUIRED";
    if (/\bselect\s+(all|multiple|two|three)\b/i.test(lower))
      return "MULTI_SELECT";
    if (/drag|move|blank|_{3,}|☐/i.test(lower))
      return "INTERACTIVE";
    if (/matching|column a|column b/i.test(lower))
      return "MATCHING";
    return choiceCount === 0 ? "FREE_RESPONSE" : "MULTIPLE_CHOICE";
  }

  // ===============================
  // CORE PIPELINE
  // ===============================
  function harvest() {
    const { cleaned, answerKey } = extractAnswerKey(cleanText(text));
    const allLines = cleaned.split("\n").map(l => l.trim()).filter(Boolean);
    
    const groups = [];
    let current = null;
    let started = false;

    allLines.forEach((line, i) => {
      if (isLikelyAnswerGridStart(allLines, i)) return; // Simple grid skip during loop
      
      const newQ = isQuestionStart(allLines, i, started);
      const header = isHeader(line);

      if (newQ || header) {
        if (current) groups.push(current);
        current = newQ ? [line] : null;
        if (newQ) started = true;
      } else if (current) {
        current.push(line);
      }
    });

    if (current) groups.push(current);

    const seen = new Set();
    const processed = groups.map(lines => {
      const raw = lines.join("\n");
      const num = String(lines[0] || "").match(/^\s*(\d{1,3})[.)]/)?.[1] || "?";
      const duplicate = seen.has(num);
      seen.add(num);

      const choiceCount = [...raw.matchAll(/(^|\s)[A-E][.)](?=\s|$)/g)].length;
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
          answerHint: answerKey[num] || null,
          constraints: { preserveConcept: true, preserveDOK: true, preserveQuestionType: true, cleanStudentReady: true }
        }
      };
    });

    setBlocks(processed);
    setMode("Dashboard");
    setIndex(0);
  }

  // ===============================
  // RENDER UI
  // ===============================
  const active = blocks[index];

  return React.createElement("div", { style: { padding: "40px", fontFamily: "sans-serif", maxWidth: "1000px", margin: "auto" } },
    React.createElement("h1", { style: { color: "#007bff" } }, "LearnFlow Pipeline"),
    React.createElement("p", { style: { fontSize: "0.8rem", color: "#666" } }, APP_VERSION),

    !mode && React.createElement("div", null,
      React.createElement("input", {
        value: globalTopic,
        onChange: e => setGlobalTopic(e.target.value),
        style: { width: "100%", padding: "10px", marginBottom: "10px" },
        placeholder: "Unit Topic (e.g. Chemistry)"
      }),
      React.createElement("input", { type: "file", accept: ".docx", onChange: handleFileUpload, style: { marginBottom: "10px", display: "block" } }),
      React.createElement("textarea", {
        value: text,
        onChange: e => setText(e.target.value),
        style: { width: "100%", height: "300px", padding: "10px" },
        placeholder: "Paste or Upload content..."
      }),
      React.createElement("button", { 
        onClick: harvest, 
        style: { marginTop: "10px", padding: "10px 20px", background: "#007bff", color: "white", border: "none", cursor: "pointer" } 
      }, "Harvest Source")
    ),

    mode === "Dashboard" && React.createElement("div", null,
      React.createElement("button", { onClick: () => setMode(null) }, "Back to Editor"),
      React.createElement("div", { style: { marginTop: "20px" } },
        blocks.map((b, i) =>
          React.createElement("div", { 
            key: i, 
            style: { padding: "10px", borderBottom: "1px solid #eee", display: "flex", justifyContent: "space-between", alignItems: "center" } 
          },
            React.createElement("span", null, `Q${b.sourceNumber} | ${b.detectedType} | ` + 
              React.createElement("span", { style: { color: b.status === "READY_TO_MIRROR" ? "green" : (b.status === "NEEDS_GRAPHIC" ? "orange" : "red") } }, b.status)
            ),
            React.createElement("button", { onClick: () => { setIndex(i); setMode("Review"); } }, "Review")
          )
        )
      )
    ),

    mode === "Review" && active && React.createElement("div", null,
      React.createElement("button", { onClick: () => setMode("Dashboard"), style: { marginBottom: "20px" } }, "Back to Dashboard"),
      React.createElement("div", { style: { display: "flex", gap: "20px" } },
        React.createElement("pre", { style: { flex: 1, background: "#f9f9f9", padding: "15px", whiteSpace: "pre-wrap", border: "1px solid #ddd" } }, active.rawText),
        React.createElement("pre", { style: { flex: 1, background: "#eef", padding: "15px", whiteSpace: "pre-wrap", border: "1px solid #ccd" } }, JSON.stringify(active.mirrorPayload, null, 2))
      )
    )
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(App));
