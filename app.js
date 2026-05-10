/**
 * LearnFlow Phase 2B.1: Hardened Source Block Pipeline
 * VERSION: 0.3.10-STABLE
 *
 * Fix:
 * - Restores DOCX upload.
 * - Keeps strong Scantron grid removal.
 * - Preserves Source Block Pipeline.
 */

const { useState } = React;

const APP_VERSION = "VERSION: SOURCE BLOCK PIPELINE v0.3.10-STABLE";

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

  function trimBeforeAssessmentStart(lines) {
    const partIndex = lines.findIndex(line =>
      /^part\s+(\d+|[ivx]+)\s*:/i.test(normalize(line))
    );

    return partIndex >= 0 ? lines.slice(partIndex + 1) : lines;
  }

  function isLikelyAnswerGridStart(lines, startIndex) {
    const window = lines.slice(startIndex, startIndex + 20).map(normalize);
    if (window.length < 8) return false;

    const shortLines = window.filter(line => line.length <= 4).length;
    const numberLines = window.filter(line => /^\d{1,3}[.)]?$/.test(line)).length;
    const letterLines = window.filter(line => /^[A-E]$/i.test(line)).length;
    const hasRealSentence = window.some(line => line.length > 20);
    const hasQuestionWords = window.some(line =>
      /\b(which|what|why|how|calculate|determine|identify|explain|select|complete|classify)\b/i.test(line)
    );

    return (
      numberLines >= 2 &&
      letterLines >= 3 &&
      shortLines >= window.length * 0.65 &&
      !hasRealSentence &&
      !hasQuestionWords
    );
  }

  function removeTrailingAnswerGrid(lines) {
    const cleaned = [];

    for (let i = 0; i < lines.length; i++) {
      if (isLikelyAnswerGridStart(lines, i)) {
        console.log("Removed trailing answer grid at line:", i);
        break;
      }
      cleaned.push(lines[i]);
    }

    return cleaned;
  }

  function detectEndLineAnswer(rawText) {
    const clean = normalize(rawText);
    const match = clean.match(/^\d{1,3}[.)]\s+(.+?)\s+([A-Ea-e])$/);

    if (!match) return null;

    const stem = match[1].trim();
    const answer = match[2].toUpperCase();

    return stem.length >= 2 ? { stem, answer } : null;
  }

  function isQuestionStart(lines, index, assessmentStarted) {
    const line = lines[index];

    if (!/^\s*\d{1,3}[.)]\s+\S+/.test(line)) return false;

    if (assessmentStarted) {
      return !isLikelyAnswerGridStart(lines, index);
    }

    const clean = normalize(line);
    const nearby = lines.slice(index, index + 6).map(normalize).join(" ");

    return (
      /\?/.test(clean) ||
      /\b(which|what|calculate|determine|identify|explain|select|write|draw|complete|classify|use|match)\b/i.test(clean) ||
      /_{3,}|☐/.test(clean) ||
      /[A-Ea-e][.)]\s*/.test(nearby) ||
      detectEndLineAnswer(line)
    );
  }

  function detectType(rawText, choiceCount) {
    const lower = rawText.toLowerCase();

    if (detectEndLineAnswer(rawText) && choiceCount === 0) return "MATCHING";
    if (/graph|figure|diagram|chart|image|insert graphic/i.test(rawText)) return "VISUAL_REQUIRED";
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

    const seen = new Set();

    const result = groups.map(lines => {
      const rawText = lines.join("\n");
      const sourceNumber = String(lines[0] || "").match(/^\s*(\d{1,3})[.)]/)?.[1] || "?";
      const duplicate = seen.has(sourceNumber);
      seen.add(sourceNumber);

      const choiceCount = [...rawText.matchAll(/[A-Ea-e][.)]+\s*/g)].length;
      const detectedType = detectType(rawText, choiceCount);

      const status = duplicate
        ? "DUPLICATE"
        : detectedType === "VISUAL_REQUIRED"
          ? "NEEDS_GRAPHIC"
          : "READY_TO_MIRROR";

      return {
        sourceNumber,
        detectedType,
        status,
        rawText,
        answerHint: base.answerKey[sourceNumber] || detectEndLineAnswer(rawText)?.answer || null,
        mirrorPayload: {
          intent: "Mirror assessment item",
          topicHint: globalTopic,
          source: rawText,
          originalNumber: sourceNumber,
          originalType: detectedType,
          answerHint: base.answerKey[sourceNumber] || detectEndLineAnswer(rawText)?.answer || null,
          constraints: {
            preserveConcept: true,
            preserveDOK: true,
            preserveQuestionType: true,
            cleanStudentReady: true,
            doNotUseOutsideConcepts: true,
            flagIfAmbiguousOrIncomplete: true
          }
        }
      };
    });

    setBlocks(result);
    setIndex(0);
    setMode("Dashboard");
  }

  const active = blocks[index];

  return React.createElement("div", {
    style: {
      padding: "40px",
      fontFamily: "sans-serif",
      maxWidth: "1000px",
      margin: "auto"
    }
  },

    React.createElement("h1", { style: { color: "#007bff" } }, "LearnFlow Pipeline"),
    React.createElement("p", { style: { fontSize: "0.8rem", color: "#888" } }, APP_VERSION),

    !mode && React.createElement("div", null,
      React.createElement("input", {
        value: globalTopic,
        onChange: e => setGlobalTopic(e.target.value),
        style: {
          width: "100%",
          padding: "10px",
          marginBottom: "10px"
        },
        placeholder: "Topic Hint, e.g. Chemistry"
      }),

      React.createElement("input", {
        type: "file",
        accept: ".docx",
        onChange: handleFileUpload,
        style: {
          display: "block",
          marginBottom: "10px"
        }
      }),

      React.createElement("textarea", {
        value: text,
        onChange: e => setText(e.target.value),
        style: {
          width: "100%",
          height: "300px",
          padding: "10px",
          marginBottom: "10px"
        },
        placeholder: "Paste content here or upload a DOCX..."
      }),

      React.createElement("button", {
        onClick: harvest,
        style: {
          padding: "10px 20px",
          background: "#007bff",
          color: "white",
          border: "none",
          cursor: "pointer"
        }
      }, "Harvest Source")
    ),

    mode === "Dashboard" && React.createElement("div", null,
      React.createElement("button", { onClick: () => setMode(null) }, "Back"),

      React.createElement("table", {
        style: {
          width: "100%",
          marginTop: "20px",
          borderCollapse: "collapse"
        }
      },
        React.createElement("tbody", null,
          blocks.map((block, i) =>
            React.createElement("tr", {
              key: i,
              style: { borderBottom: "1px solid #ddd" }
            },
              React.createElement("td", { style: { padding: "8px" } }, block.sourceNumber),
              React.createElement("td", { style: { padding: "8px" } }, block.detectedType),
              React.createElement("td", {
                style: {
                  padding: "8px",
                  color:
                    block.status === "READY_TO_MIRROR"
                      ? "green"
                      : block.status === "NEEDS_GRAPHIC"
                        ? "orange"
                        : "red"
                }
              }, block.status),
              React.createElement("td", null,
                React.createElement("button", {
                  onClick: () => {
                    setIndex(i);
                    setMode("Review");
                  }
                }, "Review")
              )
            )
          )
        )
      )
    ),

    mode === "Review" && active && React.createElement("div", null,
      React.createElement("button", { onClick: () => setMode("Dashboard") }, "Dashboard"),

      React.createElement("div", {
        style: {
          display: "flex",
          gap: "20px",
          marginTop: "20px"
        }
      },
        React.createElement("pre", {
          style: {
            flex: 1,
            background: "#f8f9fa",
            padding: "15px",
            whiteSpace: "pre-wrap",
            border: "1px solid #ddd"
          }
        }, active.rawText),

        React.createElement("pre", {
          style: {
            flex: 1,
            background: "#eef",
            padding: "15px",
            whiteSpace: "pre-wrap",
            border: "1px solid #ccd"
          }
        }, JSON.stringify(active.mirrorPayload, null, 2))
      )
    )
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  React.createElement(App)
);
