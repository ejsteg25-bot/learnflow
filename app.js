const { useState } = React;

function App() {
  const [text, setText] = useState("");
  const [questions, setQuestions] = useState([]);
  const [index, setIndex] = useState(0);
  const [issues, setIssues] = useState([]);
  const [blocked, setBlocked] = useState(false);

  const REQUIRED_LABELS = ["A", "B", "C", "D"];

  async function handleFileUpload(event) {
    const file = event.target.files[0];

    if (!file) return;

    setQuestions([]);
    setIndex(0);

    if (!file.name.toLowerCase().endsWith(".docx")) {
      setIssues([
        "Only .docx files are supported right now. PDF support should come later."
      ]);
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

      const result = await mammoth.extractRawText({
        arrayBuffer: arrayBuffer
      });

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
      cleaned.includes("do not write on this test") ||
      cleaned.includes("class set") ||
      cleaned.includes("directions:") ||
      cleaned.includes("answer the following questions") ||
      cleaned.includes("scantron") ||
      cleaned.includes("more on back")
    );
  }

  function isQuestionStart(line) {
    return /^\s*\d+\.\s+/.test(line);
  }

  function isChoiceLine(line) {
    return /^\s*[A-Da-d][\.\)]\s+/.test(line);
  }

  function isAnswerLine(line) {
    return /^ANSWER\s*:/i.test(line);
  }

  function normalizeChoiceLabel(line) {
    const match = line.match(/^\s*([A-Da-d])[\.\)]\s+(.*)$/);

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

  function parseQuestionBlock(block, foundIssues) {
    const firstLine = block[0];
    const qMatch = firstLine.match(/^\s*(\d+)\.\s+(.*)$/);

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
          foundIssues.push(
            `Question ${sourceNumber}: ANSWER line exists but no valid A-D answer found.`
          );
        } else {
          if (answer && answer !== extracted) {
            foundIssues.push(
              `Question ${sourceNumber}: answer marker conflicts with ANSWER line.`
            );
          }

          answer = extracted;
        }

        continue;
      }

      if (!readingChoices) {
        promptLines.push(line);
      } else {
        const labels = Object.keys(choices);
        const lastLabel = labels[labels.length - 1];

        if (!lastLabel) {
          foundIssues.push(
            `Question ${sourceNumber}: extra text found after choices but no choice to attach it to.`
          );
          continue;
        }

        const isCorrect = /\*{2,3}/.test(line);
        const cleanedContinuation = line.replace(/\*{2,3}/g, "").trim();

        choices[lastLabel] = `${choices[lastLabel]} ${cleanedContinuation}`.trim();

        if (isCorrect) {
          if (answer && answer !== lastLabel) {
            foundIssues.push(`Question ${sourceNumber}: multiple correct answers detected.`);
          }

          answer = lastLabel;
        }
      }
    }

    const prompt = promptLines.join(" ").trim();

    return {
      sourceNumber,
      prompt,
      choices,
      answer,
      valid: false
    };
  }

  function validateQuestion(question, foundIssues) {
    if (!question) return false;

    let valid = true;

    if (!question.sourceNumber) {
      foundIssues.push("A question is missing its source number.");
      valid = false;
    }

    if (!question.prompt || question.prompt.length < 3) {
      foundIssues.push(`Question ${question.sourceNumber}: missing or too-short prompt.`);
      valid = false;
    }

    for (const label of REQUIRED_LABELS) {
      if (!question.choices[label] || question.choices[label].trim().length === 0) {
        foundIssues.push(`Question ${question.sourceNumber}: missing choice ${label}.`);
        valid = false;
      }
    }

    const extraLabels = Object.keys(question.choices).filter(
      label => !REQUIRED_LABELS.includes(label)
    );

    if (extraLabels.length > 0) {
      foundIssues.push(
        `Question ${question.sourceNumber}: unsupported extra choices detected: ${extraLabels.join(", ")}.`
      );
      valid = false;
    }

    if (!question.answer) {
      foundIssues.push(`Question ${question.sourceNumber}: no correct answer detected.`);
      valid = false;
    }

    if (question.answer && !REQUIRED_LABELS.includes(question.answer)) {
      foundIssues.push(`Question ${question.sourceNumber}: answer must be A, B, C, or D.`);
      valid = false;
    }

    if (question.answer && !question.choices[question.answer]) {
      foundIssues.push(`Question ${question.sourceNumber}: answer points to a missing choice.`);
      valid = false;
    }

    return valid;
  }

  function validateAllQuestions(parsedQuestions, foundIssues) {
    const seenSourceNumbers = new Set();

    const validated = parsedQuestions.map(question => {
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

    return validated;
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

    if (!cleaned) {
      setQuestions([]);
      setIssues(["No text was provided. Paste text or upload a DOCX file first."]);
      setBlocked(true);
      setIndex(0);
      return;
    }

    const lines = cleaned
      .split("\n")
      .map(normalizeLine)
      .filter(line => line.length > 0)
      .filter(line => !isNoiseLine(line));

    const blocks = [];
    let currentBlock = [];

    for (const line of lines) {
      if (isQuestionStart(line)) {
        if (currentBlock.length > 0) {
          blocks.push(currentBlock);
        }

        currentBlock = [line];
      } else if (currentBlock.length > 0) {
        currentBlock.push(line);
      }
    }

    if (currentBlock.length > 0) {
      blocks.push(currentBlock);
    }

    if (blocks.length === 0) {
      setQuestions([]);
      setIssues([
        "No valid numbered questions were found. Questions must begin like: 1. Question text"
      ]);
      setBlocked(true);
      setIndex(0);
      return;
    }

    const parsed = blocks
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
      foundIssues.push(
        `${invalidCount} question(s) were blocked because they did not meet LearnFlow formatting rules.`
      );
    }

    const randomized = shuffleArray(safeDisplayQuestions(validQuestions));

    setQuestions(randomized);
    setIssues(foundIssues);
    setBlocked(invalidCount > 0);
    setIndex(0);
  }

  function nextQuestion() {
    setIndex(i => Math.min(i + 1, questions.length - 1));
  }

  function previousQuestion() {
    setIndex(i => Math.max(i - 1, 0));
  }

  const currentQuestion = questions[index];

  return React.createElement(
    "div",
    { className: "p-6 max-w-4xl mx-auto font-sans" },

    React.createElement(
      "h1",
      { className: "text-3xl font-bold mb-2" },
      "LearnFlow"
    ),

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
      placeholder:
        "1. Question text\nA. choice\nB. choice\nC. choice\nD. correct choice**"
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
        {
          className:
            "mt-4 border border-yellow-400 bg-yellow-50 p-3 rounded"
        },
        React.createElement(
          "h2",
          { className: "font-bold mb-2" },
          "Formatting / Validation Report"
        ),
        React.createElement(
          "ul",
          { className: "list-disc ml-6" },
          issues.map((issue, i) =>
            React.createElement("li", { key: i }, issue)
          )
        )
      ),

    blocked &&
      React.createElement(
        "div",
        {
          className:
            "mt-4 border border-red-400 bg-red-50 p-3 rounded text-red-800"
        },
        "Some items were blocked to protect LearnFlow rules. Fix the listed formatting issues before using this with students."
      ),

    questions.length > 0 &&
      currentQuestion &&
      React.createElement(
        "div",
        { className: "mt-6 border rounded p-4 bg-white shadow" },

        React.createElement(
          "div",
          { className: "mb-3 text-sm text-gray-600" },
          `Question ${index + 1} of ${questions.length}`
        ),

        React.createElement(
          "p",
          { className: "text-lg font-semibold mb-4" },
          currentQuestion.prompt
        ),

        React.createElement(
          "div",
          { className: "space-y-2" },
          REQUIRED_LABELS.map(label =>
            React.createElement(
              "div",
              {
                key: label,
                className: "border rounded p-2"
              },
              `${label}. ${currentQuestion.choices[label]}`
            )
          )
        ),

        React.createElement(
          "div",
          { className: "mt-4 text-sm text-gray-500" },
          `Internal source question: ${currentQuestion.sourceNumber}`
        ),

        React.createElement(
          "div",
          { className: "mt-4 text-sm text-gray-500" },
          `Correct answer stored internally: ${currentQuestion.answer}`
        ),

        React.createElement(
          "div",
          { className: "mt-4 flex gap-2" },

          React.createElement(
            "button",
            {
              className:
                "bg-gray-600 text-white px-4 py-2 rounded disabled:opacity-50",
              onClick: previousQuestion,
              disabled: index === 0
            },
            "Previous"
          ),

          React.createElement(
            "button",
            {
              className:
                "bg-green-600 text-white px-4 py-2 rounded disabled:opacity-50",
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
