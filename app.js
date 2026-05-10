/**
 * LearnFlow Phase 2B.1: Hardened Source Block Pipeline
 * VERSION: 0.3.8-STABLE
 * Architecture: Browser-loaded React (No JSX)
 * * Key Features:
 * 1. Assessment Windowing: Trims instructional headers before "Part X:".
 * 2. Scantron Killing: Identifies and truncates trailing answer grids.
 * 3. Question-Start Lookahead: Distinguishes between sub-headers and actual items.
 * 4. Rich mirrorPayload: Prepares deep metadata for Phase 3 mirroring.
 */

const { useState } = React;

const APP_VERSION = "VERSION: SOURCE BLOCK PIPELINE v0.3.8-STABLE";

function App() {
  const [text, setText] = useState("");
  const [blocks, setBlocks] = useState([]);
  const [globalTopic, setGlobalTopic] = useState("Chemistry");
  const [mode, setMode] = useState(null);
  const [index, setIndex] = useState(0);

  const normalizeLine = (l) => String(l || "").replace(/\s+/g, " ").trim();

  function cleanText(value) {
    return String(value || "")
      .replace(/\r/g, "")
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/\u00a0/g, " ")
      .trim();
  }

  // --- FILE & UTILITY HELPERS ---

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

  function extractAnswerKeyAndCleanText(value) {
    const lines = value.split("\n");
    const kept = [];
    const answerKey = {};
    let inAnswerKey = false;

    for (const line of lines) {
      const clean = normalizeLine(line);
      const lower = clean.toLowerCase();
      if (!inAnswerKey && (lower === "answer key" || lower === "answers" || lower.startsWith("key:"))) {
        inAnswerKey = true;
        continue;
      }
      if (inAnswerKey) {
        const keyMatch = clean.match(/^(\d{1,3})[.)]?\s*[-: ]?\s*([A-Ea-e*]{1,3})\b/);
        if (keyMatch) answerKey[keyMatch[1]] = keyMatch[2].replace(/\*/g, "").toUpperCase();
        continue;
      }
      kept.push(line);
    }
    return { cleanedText: kept.join("\n"), answerKey };
  }

  // --- WINDOWING & GRID REMOVAL ---

  function trimBeforeAssessmentStart(lines) {
    const partIndex = lines.findIndex(line => /^part\s+(\d+|[ivx]+)\s*:/i.test(normalizeLine(line)));
    return partIndex >= 0 ? lines.slice(partIndex + 1) : lines;
  }

  function isLikelyAnswerGridStart(lines, startIndex) {
    const window = lines.slice(startIndex, startIndex + 15).map(normalizeLine);
    if (window.length < 5) return false;

    const firstFiveAreGridTokens = window.slice(0, 5).every(line =>
      /^\d{1,3}[.)]?$/.test(line) || /^[A-E]$/i.test(line) || line === "" || line === ","
    );

    const hasChoiceLetters = window.includes("A") && window.includes("B") && window.includes("C") && window.includes("D");
    const hasQuestionWords = window.some(line => /\b(which|what|calculate|determine|explain|select|use|match|classify)\b/i.test(line));
    const hasContentLine = window.some(line => line.length > 12);

    return firstFiveAreGridTokens || (hasChoiceLetters && !hasQuestionWords && !hasContentLine);
  }

  function removeTrailingAnswerGrid(lines) {
    const cleaned = [];
    for (let i = 0; i < lines.length; i++) {
      if (isLikelyAnswerGridStart(lines, i)) break;
      cleaned.push(lines[i]);
    }
    return cleaned;
  }

  // --- QUESTION DETECTION ---

  function isQuestionStart(lines, i, assessmentStarted) {
    const line = lines[i];
    if (!/^\s*\d{1,3}[.)]\s+\S+/.test(line)) return false;
    if (assessmentStarted) return !isLikelyAnswerGridStart(lines, i);

    const clean = normalizeLine(line);
    const nearby = lines.slice(i, i + 6).map(normalizeLine).join(" ");
    return (
      /\?/.test(clean) ||
      /\b(which|what|calculate|determine|identify|explain|select|write|draw|complete|classify|use|match)\b/i.test(clean) ||
      /_{3,}|☐/.test(clean) ||
      /[A-Ea-e][.)]\s*/.test(nearby)
    );
  }

  function detectType(rawText, choiceCount) {
    const lower = rawText.toLowerCase();
    if (/graph|figure|diagram|chart|image/i.test(rawText)) return "VISUAL_REQUIRED";
    if (/\bselect\s+(all|multiple|two|three)\b/i.test(lower)) return "MULTI_SELECT";
    if (/drag|move|blank|_{3,}|☐/i.test(lower)) return "INTERACTIVE";
    if (/matching|match each/i.test(lower)) return "MATCHING";
    return choiceCount === 0 ? "FREE_RESPONSE" : "MULTIPLE_CHOICE";
  }

  // --- HARVESTER ---

  function harvest() {
    const { cleanedText, answerKey } = extractAnswerKeyAndCleanText(cleanText(text));
    const allLines = cleanedText.split("\n").map(l => l.trim()).filter(l => l);

    const assessmentLines = trimBeforeAssessmentStart(allLines);
    const rawLines = removeTrailingAnswerGrid(assessmentLines);

    const groups = [];
    let current = null;
    let assessmentStarted = false;

    rawLines.forEach((line, i) => {
      if (isQuestionStart(rawLines, i, assessmentStarted)) {
        assessmentStarted = true;
        if (current) groups.push(current);
        current = [line];
      } else if (current) {
        current.push(line);
      }
    });
    if (current) groups.push(current);

    const seenNumbers = new Set();
    const processed = groups.map(lines => {
      const rawText = lines.join("\n");
      const num = String(lines[0] || "").match(/^\s*(\d{1,3})[.)]/)?.[1] || "?";
      const duplicate = seenNumbers.has(num);
      seenNumbers.add(num);

      const choiceCount = [...rawText.matchAll(/[A-Ea-e][.)]+\s*/g)].length;
      const type = detectType(rawText, choiceCount);

      return {
        sourceNumber: num,
        detectedType: type,
        status: duplicate ? "DUPLICATE" : (type === "VISUAL_REQUIRED" ? "NEEDS_GRAPHIC" : "READY_TO_MIRROR"),
        rawText,
        mirrorPayload: {
          intent: "Mirror assessment item",
          topicHint: globalTopic,
          source: rawText,
          originalNumber: num,
          originalType: type,
          answerHint: answerKey[num] || null,
          constraints: { preserveConcept: true, preserveDOK: true, cleanStudentReady: true }
        }
      };
    });

    setBlocks(processed);
    setMode("Dashboard");
  }

  // --- UI COMPONENTS ---

  const active = blocks[index];

  return React.createElement("div", { style: { padding: "40px", fontFamily: "sans-serif", maxWidth: "1000px", margin: "auto" } },
    React.createElement("h1", { style: { color: "#007bff" } }, "LearnFlow Pipeline"),
    React.createElement("p", { style: { fontSize: "0.8rem", color: "#888" } }, APP_VERSION),

    !mode && React.createElement("div", null,
      React.createElement("input", { value: globalTopic, onChange: e => setGlobalTopic(e.target.value), style: { width: "100%", padding: "10px", marginBottom: "10px" }, placeholder: "Chemistry" }),
      React.createElement("input", { type: "file", onChange: handleFileUpload, style: { marginBottom: "10px", display: "block" } }),
      React.createElement("textarea", { value: text, onChange: e => setText(e.target.value), style: { width: "100%", height: "300px", padding: "10px" }, placeholder: "Paste text..." }),
      React.createElement("button", { onClick: harvest, style: { marginTop: "10px", padding: "10px 20px", background: "#007bff", color: "white", border: "none", cursor: "pointer" } }, "Harvest Source")
    ),

    mode === "Dashboard" && React.createElement("div", null,
      React.createElement("button", { onClick: () => setMode(null) }, "Back"),
      React.createElement("table", { style: { width: "100%", marginTop: "20px", borderCollapse: "collapse" } },
        React.createElement("tbody", null,
          blocks.map((b, i) =>
            React.createElement("tr", { key: i, style: { borderBottom: "1px solid #ddd" } },
              React.createElement("td", { style: { padding: "8px" } }, b.sourceNumber),
              React.createElement("td", { style: { padding: "8px" } }, b.detectedType),
              React.createElement("td", { style: { padding: "8px", color: b.status === "READY_TO_MIRROR" ? "green" : b.status === "NEEDS_GRAPHIC" ? "orange" : "red" } }, b.status),
              React.createElement("td", null, React.createElement("button", { onClick: () => { setIndex(i); setMode("Review"); } }, "Review"))
            )
          )
        )
      )
    ),

    mode === "Review" && active && React.createElement("div", null,
      React.createElement("button", { onClick: () => setMode("Dashboard") }, "Dashboard"),
      React.createElement("div", { style: { display: "flex", gap: "20px", marginTop: "20px" } },
        React.createElement("pre", { style: { flex: 1, background: "#f8f9fa", padding: "15px", whiteSpace: "pre-wrap", border: "1px solid #ddd" } }, active.rawText),
        React.createElement("pre", { style: { flex: 1, background: "#eef", padding: "15px", whiteSpace: "pre-wrap", border: "1px solid #ccd" } }, JSON.stringify(active.mirrorPayload, null, 2))
      )
    )
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(App));
