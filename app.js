const { useState } = React;

function App() {
  const [text, setText] = useState("");
  const [questions, setQuestions] = useState([]);
  const [index, setIndex] = useState(0);
  const [issues, setIssues] = useState([]);
  const [blocked, setBlocked] = useState(false);
  const [selectedAnswers, setSelectedAnswers] = useState({});
  const [mode, setMode] = useState(null);
  const [reteachInput, setReteachInput] = useState("");
  const [reteachMessage, setReteachMessage] = useState("");

  const REQUIRED_LABELS = ["A", "B", "C", "D"];

  async function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    resetSession();

    if (!file.name.toLowerCase().endsWith(".docx")) {
      setIssues(["Only .docx files are supported right now."]);
      setBlocked(true);
      return;
    }

    if (typeof mammoth === "undefined") {
      setIssues([
        "DOCX reader is not loaded. Make sure mammoth.browser.min.js is included in index.html before app.js."
      ]);
      setBlocked(true);
      return;
    }

    try {
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer });

      if (!result.value || !result.value.trim()) {
        setText("");
        setIssues(["The DOCX file was read, but no usable text was found."]);
        setBlocked(true);
        return;
      }

      setText(result.value);
      setIssues([
        "DOCX uploaded successfully. Review the extracted text before clicking Analyze Material."
      ]);
      setBlocked(false);
    } catch (error) {
      setIssues([
        "The DOCX file could not be read. Try saving it again as a clean .docx file."
      ]);
      setBlocked(true);
    }
  }

  function resetSession() {
    setQuestions([]);
    setSelectedAnswers({});
    setIndex(0);
    setMode(null);
    setReteachInput("");
    setReteachMessage("");
  }

  function shuffleArray(array) {
    const copy = [...array];

    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }

    return copy;
  }

  function cleanText(value) {
    return value
      .replace(/\r/g, "")
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/\u00a0/g, " ")
      .replace(/→/g, "->")
      .replace(/\s+\n/g, "\n")
      .trim();
  }

  function normalizeLine(line) {
    return line.replace(/\s+/g, " ").trim();
  }

  function isNoiseLine(line) {
  const cleaned = line.toLowerCase();

  return (
      cleaned === "matching" ||
      cleaned.includes("match each description") ||
      cleaned.includes("column a") ||
      cleaned.includes("column b") ||
      cleaned.includes("do not write on this test") ||
      cleaned.includes("class set") ||
      cleaned.includes("nomenclature test") ||
      cleaned.includes("chemical reactions test") ||
      cleaned.includes("aca chemistry") ||
      cleaned.includes("directions:") ||
      cleaned.includes("multiple choice:") ||
      cleaned.includes("answer the following questions") ||
      cleaned.includes("scantron") ||
      cleaned.includes("free response") ||
      cleaned.includes("more on back")
    );
  }

  function splitMixedChoiceLine(line) {
    const clean = normalizeLine(line);
    const pattern = /(^|\s)([A-Da-d])[\.\)]{1,2}\s*/g;
    const matches = [];
    let match;

    while ((match = pattern.exec(clean)) !== null) {
      matches.push({
        start: match.index + match[1].length,
        label: match[2].toUpperCase()
      });
    }

    if (matches.length === 0) {
      return [clean];
    }

    const parts = [];
    const firstStart = matches[0].start;

    if (firstStart > 0) {
      const prefix = clean.slice(0, firstStart).trim();
      if (prefix) parts.push(prefix);
    }

    for (let i = 0; i < matches.length; i++) {
      const start = matches[i].start;
      const end = i + 1 < matches.length ? matches[i + 1].start : clean.length;
      const piece = clean.slice(start, end).trim();

      if (piece) {
        const fixedPiece = piece.replace(/^([A-Da-d])[\.\)]{1,2}\s*/, (m, label) => {
          return label.toUpperCase() + ". ";
        });

        parts.push(fixedPiece);
      }
    }

    return parts.length > 0 ? parts : [clean];
  }

  function isQuestionStart(line) {
    return /^\s*\d+\.\s*[A-Za-z0-9]/.test(line);
  }

  function isChoiceLine(line) {
    return /^\s*[A-Da-d][\.\)]{1,2}\s*/.test(line);
  }

  function isAnswerLine(line) {
    return /^ANSWER\s*:/i.test(line);
  }

  function normalizeChoiceLabel(line) {
    const match = line.match(/^\s*([A-Da-d])[\.\)]{1,2}\s*(.*)$/);
    if (!match) return null;

    const label = match[1].toUpperCase();
    let choiceText = match[2].trim();

    const isCorrect = /\*{2,3}/.test(choiceText);
    choiceText = choiceText.replace(/\*{2,3}/g, "").trim();

    return {
      label,
      text: choiceText,
      isCorrect
    };
  }

  function extractAnswerFromLine(line) {
    const match = line.match(/^ANSWER\s*:\s*([A-Da-d])/i);
    return match ? match[1].toUpperCase() : null;
  }

  function looksLikeUnnumberedQuestion(line) {
  if (!line || line.length < 10) return false;

  // NEW: block matching-style lines
  if (
    /\([A-F]\)$/.test(line) ||
    /^[A-Za-z]+\s*\([A-F]\)/.test(line)
  ) {
    return false;
  }

  if (isChoiceLine(line)) return false;
  if (isNoiseLine(line)) return false;

    return (
      /\?$/.test(line) ||
      /\bwhich\b/i.test(line) ||
      /\bwhat\b/i.test(line) ||
      /\bwhen\b/i.test(line) ||
      /\bhow\b/i.test(line) ||
      /\bselect\b/i.test(line) ||
      /\bcorrect\b/i.test(line) ||
      /\brepresents?\b/i.test(line) ||
      /\bcalled\b/i.test(line) ||
      /\bformula\b/i.test(line) ||
      /\bcompound\b/i.test(line) ||
      /\bion\b/i.test(line) ||
      /\bname\b/i.test(line)
    );
  }

  function normalizeQuestionBlock(block) {
  if (!block || block.length === 0) return block;

  const firstLine = block[0];
  const rest = block
    .slice(1)
    .flatMap(line => splitMixedChoiceLine(line))
    .map(normalizeLine)
    .filter(Boolean);

  const choiceMap = {};
  const unlabeledLines = [];
// START: early unlabeled MC detection (fix for Question 2)
if (unlabeledLines.length >= 4) {
  const firstFour = unlabeledLines.slice(0, 4);

  const likelyChoices = firstFour.filter(line => line.length < 60);

  if (likelyChoices.length === 4) {
    return [
      firstLine,
      `A. ${firstFour[0]}`,
      `B. ${firstFour[1]}`,
      `C. ${firstFour[2]}`,
      `D. ${firstFour[3]}`
    ];
  }
}
// END
    
  for (const line of rest) {
    const choice = normalizeChoiceLabel(line);

    if (choice) {
      const cleanedChoiceLine = `${choice.label}. ${choice.text}${choice.isCorrect ? " ***" : ""}`;

      if (!choiceMap[choice.label]) {
        choiceMap[choice.label] = cleanedChoiceLine;
      }

      continue;
    }

    unlabeledLines.push(line);
  }

  const labelsFound = Object.keys(choiceMap);

  // FIRST: if the last 4 unlabeled lines look like answer choices, use them.
  // This catches questions where choices have no A/B/C/D labels.
if (unlabeledLines.length >= 4) {
  for (let i = 0; i <= unlabeledLines.length - 4; i++) {
    const group = unlabeledLines.slice(i, i + 4);
    const likelyChoices = group.filter(line => line.length < 60);

    if (likelyChoices.length === 4) {
      const possiblePromptLines = [
        ...unlabeledLines.slice(0, i),
        ...unlabeledLines.slice(i + 4)
      ];

      return [
        firstLine,
        ...possiblePromptLines,
        `A. ${group[0]}`,
        `B. ${group[1]}`,
        `C. ${group[2]}`,
        `D. ${group[3]}`
      ];
    }
  }
}

  // Fully labeled A-D choices.
  if (labelsFound.length === 4) {
    return [
      firstLine,
      ...unlabeledLines,
      ...REQUIRED_LABELS.map(label => choiceMap[label])
    ];
  }

  // Mixed format: some labels exist, some choices are unlabeled.
  if (labelsFound.length > 0 && labelsFound.length < 4) {
    const missingLabels = REQUIRED_LABELS.filter(label => !choiceMap[label]);
    const fallbackChoices = unlabeledLines.slice(-missingLabels.length);
    const possiblePromptLines = unlabeledLines.slice(0, unlabeledLines.length - fallbackChoices.length);

    missingLabels.forEach((label, i) => {
      if (fallbackChoices[i]) {
        choiceMap[label] = `${label}. ${fallbackChoices[i]}`;
      }
    });

    return [
      firstLine,
      ...possiblePromptLines,
      ...REQUIRED_LABELS
        .filter(label => choiceMap[label])
        .map(label => choiceMap[label])
    ];
  }

  return [firstLine, ...rest];
}

  function parseQuestionBlock(block, foundIssues) {
    const firstLine = block[0];
    const qMatch = firstLine.match(/^\s*(\d+)\.\s*(.*)$/);

    if (!qMatch) {
      foundIssues.push("A question block was found but did not start correctly.");
      return null;
    }

    const sourceNumber = qMatch[1];
    const promptLines = [qMatch[2].trim()];
    const choices = {};
    let answer = null;
    let readingChoices = false;

    for (let i = 1; i < block.length; i++) {
      const line = normalizeLine(block[i]);

      if (!line || isNoiseLine(line)) continue;

      if (isChoiceLine(line)) {
        readingChoices = true;

        const choice = normalizeChoiceLabel(line);

        if (!choice) {
          foundIssues.push(`Question ${sourceNumber}: malformed answer choice.`);
          continue;
        }

        if (choices[choice.label]) {
          foundIssues.push(`Question ${sourceNumber}: duplicate choice ${choice.label}.`);
          continue;
        }

        choices[choice.label] = choice.text;

        if (choice.isCorrect) {
          if (answer && answer !== choice.label) {
            foundIssues.push(`Question ${sourceNumber}: multiple correct answers detected.`);
          }

          answer = choice.label;
        }

        continue;
      }

      if (isAnswerLine(line)) {
        const extracted = extractAnswerFromLine(line);

        if (!extracted) {
          foundIssues.push(`Question ${sourceNumber}: ANSWER line exists but no valid A-D answer found.`);
        } else {
          if (answer && answer !== extracted) {
            foundIssues.push(`Question ${sourceNumber}: answer marker conflicts with ANSWER line.`);
          }

          answer = extracted;
        }

        continue;
      }

     // START: detect unlabeled answer choices
if (line.length < 60 && Object.keys(choices).length < 4) {
  const nextLabel = REQUIRED_LABELS[Object.keys(choices).length];

  choices[nextLabel] = line;
  readingChoices = true;
  continue;
}

if (!readingChoices) {
  promptLines.push(line);
}
// END
    }

    return {
      sourceNumber,
      prompt: promptLines.join(" ").trim(),
      choices,
      answer,
      valid: false
    };
  }

  function validateQuestion(question, foundIssues) {
    if (!question) return false;

    let valid = true;

    if (!question.sourceNumber) valid = false;
    if (!question.prompt || question.prompt.length < 3) valid = false;

    if (Object.keys(question.choices).length === 0) {
    return false;
    }
    
    for (const label of REQUIRED_LABELS) {
      if (!question.choices[label] || question.choices[label].trim().length === 0) {
        foundIssues.push(`Question ${question.sourceNumber}: missing choice ${label}.`);
        valid = false;
      }
    }

    if (!question.answer) {
      foundIssues.push(`Question ${question.sourceNumber}: no correct answer detected (allowed in Quiz mode).`);
      question.answer = null;
    }

    if (question.answer && !REQUIRED_LABELS.includes(question.answer)) {
      foundIssues.push(`Question ${question.sourceNumber}: answer must be A, B, C, or D.`);
      valid = false;
    }

    return valid;
  }

  function validateAllQuestions(parsedQuestions, foundIssues) {
    const seenSourceNumbers = new Set();

    return parsedQuestions.map(question => {
      const copy = { ...question };

      if (seenSourceNumbers.has(copy.sourceNumber)) {
        foundIssues.push(`Question ${copy.sourceNumber}: duplicate source number detected.`);
        copy.valid = false;
        return copy;
      }

      seenSourceNumbers.add(copy.sourceNumber);
      copy.valid = validateQuestion(copy, foundIssues);

      return copy;
    });
  }

  function safeDisplayQuestions(validQuestions) {
    return validQuestions.map(question => ({
      sourceNumber: question.sourceNumber,
      prompt: question.prompt,
      choices: {
        A: question.choices.A,
        B: question.choices.B,
        C: question.choices.C,
        D: question.choices.D
      },
      answer: question.answer
    }));
  }

  function parse() {
    const foundIssues = [];
    const cleaned = cleanText(text);

    setMode(null);
    setSelectedAnswers({});
    setReteachInput("");
    setReteachMessage("");

    if (!cleaned) {
      setQuestions([]);
      setIssues(["No text was provided. Paste text or upload a DOCX file first."]);
      setBlocked(true);
      setIndex(0);
      return;
    }

    const rawLines = cleaned.split("\n");

    const lines = rawLines
      .flatMap(line => splitMixedChoiceLine(line))
      .map(normalizeLine)
      .filter(line => line.length > 0)
      .filter(line => !isNoiseLine(line));

    const blocks = [];
    let currentBlock = [];
    let autoNumber = 1;

    for (const line of lines) {
      if (isQuestionStart(line)) {
        if (currentBlock.length > 0) blocks.push(currentBlock);

        currentBlock = [line];

        const numberMatch = line.match(/^\s*(\d+)\./);
        if (numberMatch) {
          autoNumber = Math.max(autoNumber, Number(numberMatch[1]) + 1);
        }
      } else if (looksLikeUnnumberedQuestion(line)) {
        if (currentBlock.length > 0) blocks.push(currentBlock);

        currentBlock = [`${autoNumber}. ${line}`];
        autoNumber++;
      } else if (currentBlock.length > 0) {
        currentBlock.push(line);
      } else if (blocks.length === 0 && line.length > 10) {
        currentBlock = [`${autoNumber}. ${line}`];
        autoNumber++;
      }
    }

    if (currentBlock.length > 0) blocks.push(currentBlock);

    if (blocks.length === 0) {
      setQuestions([]);
      setIssues(["No valid numbered questions were found. Questions must begin like: 1. Question text"]);
      setBlocked(true);
      setIndex(0);
      return;
    }

    const parsed = blocks
      .map(block => normalizeQuestionBlock(block))
      .map(block => parseQuestionBlock(block, foundIssues))
      .filter(Boolean);

    const validated = validateAllQuestions(parsed, foundIssues);
    const validQuestions = validated.filter(question => question.valid);

    if (validQuestions.length === 0) {
      setQuestions([]);
      setIssues([
        ...foundIssues,
        "No questions were allowed into Quiz/Tutor because none passed validation."
      ]);
      setBlocked(true);
      setIndex(0);
      return;
    }

    const invalidCount = validated.length - validQuestions.length;

    if (invalidCount > 0) {
      foundIssues.push(`${invalidCount} question(s) were skipped because they did not meet LearnFlow formatting rules.`);
    }

    setQuestions(shuffleArray(safeDisplayQuestions(validQuestions)));
    setIssues(foundIssues);
    setBlocked(invalidCount > 0);
    setIndex(0);
  }

  function startMode(selectedMode) {
    setMode(selectedMode);
    setIndex(0);
    setSelectedAnswers({});
    setReteachInput("");
    setReteachMessage("");
  }

  function startReteach() {
    const requested = reteachInput.trim();

    if (!requested) {
      setReteachMessage("Enter a source question number first.");
      return;
    }

    const foundIndex = questions.findIndex(q => q.sourceNumber === requested);

    if (foundIndex === -1) {
      setReteachMessage(`Question ${requested} was not found or was skipped during validation.`);
      return;
    }

    setIndex(foundIndex);
    setReteachMessage("");
  }

  function selectAnswer(label) {
    const currentQuestion = questions[index];
    if (!currentQuestion) return;

    setSelectedAnswers(prev => ({
      ...prev,
      [currentQuestion.sourceNumber]: label
    }));
  }

  function nextQuestion() {
    setIndex(i => Math.min(i + 1, questions.length - 1));
  }

  function previousQuestion() {
    setIndex(i => Math.max(i - 1, 0));
  }

  function backToModes() {
    setMode(null);
    setSelectedAnswers({});
    setReteachInput("");
    setReteachMessage("");
    setIndex(0);
  }

  const currentQuestion = questions[index];

  return React.createElement(
    "div",
    { className: "p-6 max-w-4xl mx-auto font-sans" },

    React.createElement("h1", { className: "text-3xl font-bold mb-2" }, "LearnFlow"),

    React.createElement(
      "p",
      { className: "mb-4 text-gray-700" },
      "Upload a DOCX file or paste text below. Review the extracted text before analyzing."
    ),

    React.createElement("input", {
      type: "file",
      accept: ".docx",
      className: "mb-4 block border rounded p-2",
      onChange: handleFileUpload
    }),

    React.createElement("textarea", {
      className: "w-full border rounded p-3 mb-4",
      rows: 12,
      value: text,
      onChange: e => setText(e.target.value),
      placeholder: "1. Question text\nA. choice\nB. choice\nC. choice\nD. correct choice**"
    }),

    React.createElement(
      "button",
      {
        className: "bg-blue-600 text-white px-4 py-2 rounded",
        onClick: parse
      },
      "Analyze Material"
    ),

    issues.length > 0 &&
      React.createElement(
        "div",
        { className: "mt-4 border border-yellow-400 bg-yellow-50 p-3 rounded" },
        React.createElement("h2", { className: "font-bold mb-2" }, "Formatting / Validation Report"),
        React.createElement(
          "ul",
          { className: "list-disc ml-6" },
          issues.map((issue, i) => React.createElement("li", { key: i }, issue))
        )
      ),

    blocked &&
      React.createElement(
        "div",
        { className: "mt-4 border border-red-400 bg-red-50 p-3 rounded text-red-800" },
        "Some items were skipped or blocked to protect LearnFlow rules."
      ),

    questions.length > 0 &&
      !mode &&
      React.createElement(
        "div",
        { className: "mt-6 border rounded p-5 bg-white shadow" },

        React.createElement("h2", { className: "text-xl font-bold mb-2" }, "Choose a Mode"),

        React.createElement(
          "p",
          { className: "text-gray-600 mb-4" },
          `${questions.length} valid question(s) are ready.`
        ),

        React.createElement(
          "div",
          { className: "grid md:grid-cols-3 gap-3" },

          React.createElement(
            "button",
            {
              className: "border rounded p-4 text-left hover:bg-blue-50",
              onClick: () => startMode("Quiz")
            },
            React.createElement("div", { className: "font-bold text-blue-700" }, "Quiz Mode"),
            React.createElement("div", { className: "text-sm text-gray-600" }, "Independent practice.")
          ),

          React.createElement(
            "button",
            {
              className: "border rounded p-4 text-left hover:bg-green-50",
              onClick: () => startMode("Tutor")
            },
            React.createElement("div", { className: "font-bold text-green-700" }, "Tutor Mode"),
            React.createElement("div", { className: "text-sm text-gray-600" }, "Guided support mode.")
          ),

          React.createElement(
            "button",
            {
              className: "border rounded p-4 text-left hover:bg-purple-50",
              onClick: () => startMode("Reteach")
            },
            React.createElement("div", { className: "font-bold text-purple-700" }, "Reteach Mode"),
            React.createElement("div", { className: "text-sm text-gray-600" }, "Load exact source question.")
          )
        )
      ),

    questions.length > 0 &&
      mode === "Reteach" &&
      React.createElement(
        "div",
        { className: "mt-6 border rounded p-4 bg-purple-50" },

        React.createElement("h2", { className: "font-bold mb-2" }, "Reteach Lookup"),

        React.createElement(
          "div",
          { className: "flex gap-2 mb-2" },
          React.createElement("input", {
            className: "border rounded p-2 flex-1",
            value: reteachInput,
            onChange: e => setReteachInput(e.target.value),
            placeholder: "Enter source question number, example: 14"
          }),
          React.createElement(
            "button",
            {
              className: "bg-purple-600 text-white px-4 py-2 rounded",
              onClick: startReteach
            },
            "Load"
          )
        ),

        reteachMessage &&
          React.createElement("p", { className: "text-sm text-red-700" }, reteachMessage)
      ),

    questions.length > 0 &&
      mode &&
      currentQuestion &&
      React.createElement(
        "div",
        { className: "mt-6 border rounded p-4 bg-white shadow" },

        React.createElement(
          "div",
          { className: "mb-3 flex justify-between items-center text-sm text-gray-600" },
          React.createElement(
            "span",
            null,
            mode === "Reteach"
              ? `Reteach: Source Question ${currentQuestion.sourceNumber}`
              : `${mode} Mode — Question ${index + 1} of ${questions.length}`
          ),
          React.createElement(
            "button",
            {
              className: "text-blue-600 underline",
              onClick: backToModes
            },
            "Change Mode"
          )
        ),

        React.createElement(
          "p",
          { className: "text-lg font-semibold mb-4" },
          currentQuestion.prompt
        ),

        React.createElement(
          "div",
          { className: "space-y-2" },
          REQUIRED_LABELS.map(label => {
            const isSelected =
              selectedAnswers[currentQuestion.sourceNumber] === label;

            return React.createElement(
              "button",
              {
                key: label,
                className: isSelected
                  ? "w-full text-left border rounded p-2 bg-blue-100 border-blue-500"
                  : "w-full text-left border rounded p-2 bg-white hover:bg-gray-100",
                onClick: () => selectAnswer(label)
              },
              `${label}. ${currentQuestion.choices[label]}`
            );
          })
        ),

        mode !== "Reteach" &&
          React.createElement(
            "div",
            { className: "mt-4 flex gap-2" },

            React.createElement(
              "button",
              {
                className: "bg-gray-600 text-white px-4 py-2 rounded disabled:opacity-50",
                onClick: previousQuestion,
                disabled: index === 0
              },
              "Previous"
            ),

            React.createElement(
              "button",
              {
                className: "bg-green-600 text-white px-4 py-2 rounded disabled:opacity-50",
                onClick: nextQuestion,
                disabled: index === questions.length - 1
              },
              "Next"
            )
          )
      )
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  React.createElement(App)
);
