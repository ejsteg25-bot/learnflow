const { useState } = React;

function App() {
  const [text, setText] = useState("");
  const [blocks, setBlocks] = useState([]);
  const [mode, setMode] = useState(null);
  const [index, setIndex] = useState(0);

  const REQUIRED_LABELS = ["A", "B", "C", "D"];

  // ===============================
  // FILE UPLOAD
  // ===============================
  async function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    if (typeof mammoth === "undefined") {
      alert("Mammoth not loaded");
      return;
    }

    const buffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer: buffer });
    setText(result.value || "");
  }

  // ===============================
  // HELPERS
  // ===============================
  function cleanText(v) {
    return v
      .replace(/\r/g, "")
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/\u00a0/g, " ")
      .trim();
  }

  function normalizeLine(l) {
  return l.replace(/\s+/g, " ").trim();
}
  
 function verticalizeChoices(v) {
  return v
    // 1. Force break on "NaSO4B." (No space collision)
    .replace(/([^\s])(?=[B-Eb-e][.)]+\s*)/g, "$1\n")
    // 2. Force break on Tabs or large gaps
    .replace(/(\s{2,}|\t)+(?=[A-Ea-e][.)]+\s*)/g, "\n")
    // 3. Force break on standard inline spaces
    .replace(/\s+(?=[A-Ea-e][.)]+\s*)/g, "\n");
}

  function isQuestionStart(line) {
    // FIXED: no uppercase requirement
    return /^\d+[.)]\s+/.test(line);
  }

  function parseChoiceLine(line) {
   const m = line.match(/^\s*([A-E])[\.)]+\s*(.*)$/i);
    if (!m) return null;

    let text = m[2];
    const isCorrect = /\*{2,3}/.test(text);

    text = text.replace(/\*{2,3}/g, "").trim();

    return { label: m[1].toUpperCase(), text, isCorrect };
  }

  function parseAnswerLine(line) {
    const m = line.match(/answer.*?\b([A-E])\b/i);
    return m ? m[1].toUpperCase() : null;
  }

  // ===============================
  // ANSWER KEY EXTRACTION
  // ===============================
  function extractAnswerKey(text) {
    const lines = text.split("\n");
    let keyMode = false;

    const kept = [];
    const map = {};

    for (let line of lines) {
      const l = normalizeLine(line).toLowerCase();

      if (!keyMode && l.includes("answer key")) {
        keyMode = true;
        continue;
      }

      if (keyMode) {
        const m = line.match(/^(\d+).*?\b([A-E])\b/i);
        if (m) map[m[1]] = m[2].toUpperCase();
        continue;
      }

      kept.push(line);
    }

    return {
      cleanedText: kept.join("\n"),
      answerKey: map
    };
  }

  // ===============================
  // CLASSIFICATION
  // ===============================
  function classifyBlock(block, seenNumbers, seenText) {
    const sig = block.prompt.toLowerCase().replace(/\s+/g, "");

    if (seenNumbers.has(block.sourceNumber) || seenText.has(sig)) {
      return { primaryStatus: "Duplicate", diagnostic: "Duplicate" };
    }

    if (/\[insert graphic/i.test(block.rawText)) {
      return { primaryStatus: "Visual Required" };
    }

    if (/drag|hot spot|move/i.test(block.rawText)) {
      return { primaryStatus: "Interactive" };
    }

    if (/select two|select all/i.test(block.rawText)) {
      return { primaryStatus: "Multi-Select" };
    }

    const count = Object.keys(block.choices).length;
    const hasAD = REQUIRED_LABELS.every(l => block.choices[l]);

    if (count === 4 && hasAD) {
      if (block.answer) return { primaryStatus: "Ready" };
      return { primaryStatus: "Needs Review", diagnostic: "Missing answer" };
    }

    return { primaryStatus: "Needs Review", diagnostic: "Bad choices" };
  }

  // ===============================
  // PARSER
  // ===============================
 function parse() {
  const cleaned = cleanText(text);
  const { cleanedText, answerKey } = extractAnswerKey(cleaned);

const rawLines = cleanedText.split("\n");

console.log("RAW Q LINES:", rawLines);

const lines = rawLines
  .flatMap(line => {
    const v = verticalizeChoices(line);
    console.log("BEFORE:", line);
    console.log("AFTER:", v);
    return v.split("\n");
  })
  .map(normalizeLine)
  .filter(l => l);

console.log("FINAL LINES:", lines);

console.log("LINES:", lines);

    const rawBlocks = [];
    let current = null;

    lines.forEach(line => {
      if (isQuestionStart(line)) {
        if (current) rawBlocks.push(current);
        current = [line];
      } else if (current) {
        current.push(line);
      }
    });

    if (current) rawBlocks.push(current);

    const seenNumbers = new Set();
    const seenText = new Set();

    const parsed = rawBlocks.map(block => {
      const first = block[0].match(/^(\d+)/);
      if (!first) return null;

      const num = first[1];

      let choices = {};
      let answer = null;
      let promptLines = [block[0].replace(/^\d+[.)]\s*/, "")];

      block.slice(1).forEach(line => {
        const c = parseChoiceLine(line);

        if (c) {
          choices[c.label] = c.text;
          if (c.isCorrect) answer = c.label;
        } else if (/answer/i.test(line)) {
          const k = parseAnswerLine(line);
          if (k) answer = k;
        } else {
          promptLines.push(line);
        }
      });

      // 🔥 KEY FIX: LAST 4 LINES FALLBACK
     if (Object.keys(choices).length === 0) {
  const contentOnly = block
    .slice(1)
    .map(l => l.trim())
    .filter(l =>
      l.length > 0 &&
      !/^answer/i.test(l) &&
      !/^[A-E][\.)]/i.test(l)
    );

  const likelyChoices = contentOnly.filter(l => l.length < 50);

  if (likelyChoices.length >= 4) {
    const lastFour = likelyChoices.slice(-4);

    lastFour.forEach((line, i) => {
      choices[REQUIRED_LABELS[i]] = line;
    });

    promptLines = [
      block[0].replace(/^\d+[.)]\s*/, ""),
      ...likelyChoices.slice(0, -4)
    ];
  }
}

      const finalAnswer = answer || answerKey[num] || null;

      const obj = {
        sourceNumber: num,
        prompt: promptLines.join(" "),
        choices,
        answer: finalAnswer,
        rawText: block.join("\n")
      };

      obj.classification = classifyBlock(obj, seenNumbers, seenText);

      seenNumbers.add(num);
      seenText.add(obj.prompt.toLowerCase().replace(/\s+/g, ""));

      return obj;
    }).filter(Boolean);

    setBlocks(parsed);
    setMode("Dashboard");
  }

  // ===============================
  // UI
  // ===============================
  function counts() {
    const c = {};
    blocks.forEach(b => {
      c[b.classification.primaryStatus] =
        (c[b.classification.primaryStatus] || 0) + 1;
    });
    return c;
  }

  const c = counts();
  const current = blocks[index];

  return React.createElement("div", { style: { padding: 20 } },

    React.createElement("h1", null, "LearnFlow"),
    React.createElement("p", null, "VERSION: LIVE FIX"),

    !mode && React.createElement("div", null,
      React.createElement("input", { type: "file", onChange: handleFileUpload }),
      React.createElement("textarea", {
        value: text,
        onChange: e => setText(e.target.value),
        style: { width: "100%", height: 200 }
      }),
      React.createElement("button", { onClick: parse }, "Analyze")
    ),

    mode === "Dashboard" && React.createElement("div", null,
      React.createElement("pre", null, JSON.stringify(c, null, 2)),

      blocks.map((b, i) =>
        React.createElement("div", { key: i },
          `Q${b.sourceNumber} - ${b.classification.primaryStatus}`,
          React.createElement("button", {
            onClick: () => { setIndex(i); setMode("Editor"); }
          }, "Edit")
        )
      )
    ),

    mode === "Editor" && current && React.createElement("div", null,
      React.createElement("h3", null, current.prompt),

      REQUIRED_LABELS.map(l =>
        React.createElement("button", {
          key: l,
          onClick: () => {
            const copy = [...blocks];
            copy[index].answer = l;
            setBlocks(copy);
          }
        }, `${l}. ${current.choices[l] || ""}`)
      ),

      React.createElement("button", { onClick: () => setMode("Dashboard") }, "Back")
    )
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  React.createElement(App)
);
