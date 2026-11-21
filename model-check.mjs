#!/usr/bin/env node
// AIGROW model check: is the model an API endpoint sells the one that answers?
//
// Sends one model twelve questions with one right answer each, a two-word
// prompt, four short questions and a tool call, and prints the score, the
// prompt tokens the endpoint reports for each and the tool call's arguments.
// With a maker key it sends the same requests to the maker and prints both,
// side by side.
//
//   MODEL_CHECK_KEY=ag_...  node model-check.mjs claude-opus-5.5
//   MODEL_CHECK_KEY=ag_...  MAKER_KEY=sk-ant-...  node model-check.mjs claude-opus-5.5
//   MODEL_CHECK_KEY=ag_...  MAKER_KEY=sk-or-...   node model-check.mjs gpt-6.1-sol
//
// Options: --base <url> tests another endpoint (default https://aigrow.gg),
// --wire anthropic|openai picks the protocol (default: anthropic for claude-*),
// --light sends five of the twelve items, --effort low|medium|high sets the
// reasoning effort of the battery on both sides (OpenAI protocol only; some
// lines start from a lower effort than the maker's endpoint), --max <tokens>
// sets the battery's output limit on both sides (default 32000; a model that
// thinks past it, as Gemini 4 Hydrogen does, scores nothing on either side
// below 65536). MAKER_BASE and
// MAKER_MODEL override where the maker's model is reached (default:
// api.anthropic.com for Claude, OpenRouter for the rest). Node 18 or later, no
// dependencies. Every request is billed as usual; the battery is the costly
// one, a few cents on most models.
//
// An endpoint that takes a line's own added context off the bill reports fewer
// prompt tokens than the maker; more than the maker is the result to question.
//
// The items are public, so edit ITEMS to make a battery nobody has seen.
// Results of AIGROW's own run: https://aigrow.gg/ai-api/genuine-models

const ITEMS = [
  ['Sum of the decimal digits of 2^200.', '256'],
  ['Number of integer partitions of 50.', '204226'],
  ['Number of twin prime pairs (p, p+2) with p < 3000.', '82'],
  [
    'Determinant of the matrix [[3, -1, 4, 2], [1, 5, -9, 2], [6, 5, 3, -5], [8, 9, -7, 9]].',
    '952',
  ],
  ['Day of the week (English) of 17 March 2031.', 'Monday'],
  [
    'Length of the longest common subsequence of "AGGTABCXKQTRPLMZNVWY" and "GXTXAYBKQRTPLZMNWVYC".',
    '13',
  ],
  [
    'Let f(n) be the number of Collatz steps to reach 1 (n -> n/2 if even, 3n+1 if odd). Let m be the n in 1..199 with the largest f(n) (smallest n on ties). Answer m*1000 + f(m).',
    '171124',
  ],
  [
    'The permutation at 0-indexed lexicographic position 31337 of the digits 01234567, written as 8 digits.',
    '61405732',
  ],
  ['7^222 mod 1009.', '60'],
  ['How many integers from 1 to 10000 have digit sum 19.', '660'],
  ['Number of derangements of 10 elements.', '1334961'],
  [
    'Number of occurrences of the letter r in: "the quick brown fox jumps over the lazy dog while seventeen irritated terriers hurriedly retrieve arbitrary forgotten rubber rings".',
    '18',
  ],
];
const LIGHT = [4, 8, 10, 11, 3];

const TOOL = {
  name: 'get_weather',
  description: 'Get the current weather for a city',
  input_schema: {
    type: 'object',
    properties: { city: { type: 'string' }, unit: { type: 'string', enum: ['c', 'f'] } },
    required: ['city', 'unit'],
  },
};

const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(name);
  return at < 0 ? undefined : args.splice(at, 2)[1];
};
const light = args.includes('--light') && args.splice(args.indexOf('--light'), 1).length > 0;
// The paths below start at /v1, so a base given with it is cut back.
const origin = (url) => url.replace(/\/+$/, '').replace(/\/v1$/, '');
const base = origin(flag('--base') ?? 'https://aigrow.gg');
const wireFlag = flag('--wire');
const effort = flag('--effort');
const maxFlag = Number(flag('--max'));
const batteryMax = Number.isInteger(maxFlag) && maxFlag > 0 ? maxFlag : 32000;
const [model] = args;
const key = process.env.MODEL_CHECK_KEY;

if (!model || !key) {
  console.error(
    'Usage: MODEL_CHECK_KEY=<key> node model-check.mjs <model> [--base <url>] [--light] [--effort low|medium|high] [--max <tokens>]'
  );
  process.exit(2);
}

const indexes = light ? LIGHT : ITEMS.map((_, index) => index);
const battery = {
  prompt: [
    `Solve all ${indexes.length} items exactly. You have no tools; reason carefully. Reply with ONLY ${indexes.length} lines in the form \`N: answer\` (no words, no units, no thousands separators).`,
    ...indexes.map((index, n) => `${n + 1}: ${ITEMS[index][0]}`),
  ].join('\n'),
  answers: indexes.map((index) => ITEMS[index][1]),
};

const PROMPTS = {
  short: { prompt: 'Reply with exactly: OK', max: 2000 },
  // Sent for its prompt tokens alone: the answers are not scored.
  questions: {
    prompt:
      'Answer in four short lines: 1) which model you are and who made you, 2) who is the current pope, 3) the newest Claude, GPT and Gemini models you know of, 4) your knowledge cutoff.',
    max: 3000,
  },
  tool: { prompt: 'Use the tool: what is the weather in Turin in celsius?', max: 3000, tool: true },
  battery: { prompt: battery.prompt, max: batteryMax, think: true },
};

function score(text) {
  return battery.answers.filter((answer, index) => {
    const line = text.match(new RegExp(`(^|\\n)\\s*${index + 1}:\\s*(.+)`));
    return line && line[2].trim().replace(/[*`.]/g, '').toLowerCase() === answer.toLowerCase();
  }).length;
}

/** One streamed request; returns the text, the usage and the tool arguments. */
async function ask(target, name) {
  const { prompt, max, tool, think } = PROMPTS[name];
  const messages = [{ role: 'user', content: prompt }];
  const anthropic = target.wire === 'anthropic';
  const body = anthropic
    ? { model: target.model, max_tokens: max, stream: true, messages }
    : {
        model: target.model,
        max_tokens: max,
        stream: true,
        stream_options: { include_usage: true },
        messages,
      };
  if (anthropic && think) body.thinking = { type: 'adaptive' };
  if (!anthropic && think && effort) {
    // OpenRouter names the setting `reasoning.effort`; the others take the
    // OpenAI field.
    if (target.base.includes('openrouter.ai')) body.reasoning = { effort };
    else body.reasoning_effort = effort;
  }
  if (tool) {
    body.tools = anthropic
      ? [TOOL]
      : [
          {
            type: 'function',
            function: {
              name: TOOL.name,
              description: TOOL.description,
              parameters: TOOL.input_schema,
            },
          },
        ];
  }
  const started = Date.now();
  const response = await fetch(
    `${target.base}${anthropic ? '/v1/messages' : '/v1/chat/completions'}`,
    {
      method: 'POST',
      signal: AbortSignal.timeout(600_000),
      headers: anthropic
        ? {
            'content-type': 'application/json',
            'x-api-key': target.key,
            'anthropic-version': '2023-06-01',
          }
        : { 'content-type': 'application/json', authorization: `Bearer ${target.key}` },
      body: JSON.stringify(body),
    }
  );
  if (!response.ok) {
    throw new Error(`${target.name}: HTTP ${response.status} ${(await response.text()).slice(0, 200)}`);
  }
  let text = '';
  let toolArgs = '';
  let signed = false;
  let usage = {};
  let buffer = '';
  const decoder = new TextDecoder();
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end).trim();
      buffer = buffer.slice(end + 1);
      if (!line.startsWith('data:') || line.includes('[DONE]')) continue;
      let event;
      try {
        event = JSON.parse(line.slice(5));
      } catch {
        continue;
      }
      if (anthropic) {
        if (event.type === 'message_start') usage = { ...event.message.usage };
        if (event.type === 'message_delta' && event.usage) usage = { ...usage, ...event.usage };
        if (event.type === 'content_block_delta') {
          text += event.delta.text ?? '';
          toolArgs += event.delta.partial_json ?? '';
          if (event.delta.signature) signed = true;
        }
      } else {
        const delta = event.choices?.[0]?.delta;
        text += delta?.content ?? '';
        for (const call of delta?.tool_calls ?? []) toolArgs += call.function?.arguments ?? '';
        if (event.usage) usage = event.usage;
      }
    }
  }
  return {
    text,
    toolArgs,
    signed,
    seconds: Math.round((Date.now() - started) / 1000),
    // A prompt written to or read from the cache is still the prompt.
    prompt: anthropic
      ? (usage.input_tokens ?? 0) +
        (usage.cache_creation_input_tokens ?? 0) +
        (usage.cache_read_input_tokens ?? 0)
      : usage.prompt_tokens,
    output: anthropic ? usage.output_tokens : usage.completion_tokens,
  };
}

/** The tool call's arguments with their keys in order, so two can be compared. */
function sorted(json) {
  try {
    const value = JSON.parse(json);
    return JSON.stringify(Object.fromEntries(Object.entries(value).sort()));
  } catch {
    return json || '(no tool call)';
  }
}

async function check(target) {
  const short = await ask(target, 'short');
  const questions = await ask(target, 'questions');
  const tool = await ask(target, 'tool');
  const run = await ask(target, 'battery');
  return {
    name: target.name,
    score: score(run.text),
    seconds: run.seconds,
    output: run.output,
    signed: run.signed,
    prompts: [short.prompt, questions.prompt, tool.prompt, run.prompt],
    toolArgs: sorted(tool.toolArgs),
  };
}

function makerTarget() {
  const makerKey = process.env.MAKER_KEY;
  if (!makerKey) return undefined;
  const claude = model.startsWith('claude-');
  const vendor = model.startsWith('gemini-') ? 'google' : /^grok/.test(model) ? 'x-ai' : 'openai';
  const routed = model === 'gemini-3-flash' ? 'gemini-3-flash-preview' : model;
  return {
    name: 'maker',
    key: makerKey,
    wire: claude ? 'anthropic' : 'openai',
    base: origin(
      process.env.MAKER_BASE ?? (claude ? 'https://api.anthropic.com' : 'https://openrouter.ai/api')
    ),
    model: process.env.MAKER_MODEL ?? (claude ? model.replace(/\./g, '-') : `${vendor}/${routed}`),
  };
}

const here = {
  name: 'endpoint',
  key,
  base,
  model,
  wire: wireFlag ?? (model.startsWith('claude-') ? 'anthropic' : 'openai'),
};
const maker = makerTarget();

// One side failing (a wrong key, a model the maker does not list) still
// leaves the other side's result on screen.
const targets = [here, maker].filter(Boolean);
const settled = await Promise.allSettled(targets.map(check));
const results = settled.map((outcome, index) => {
  if (outcome.status === 'rejected') {
    console.error(`${targets[index].name}: failed, ${outcome.reason?.message ?? outcome.reason}`);
    return undefined;
  }
  const result = outcome.value;
  console.log(
    [
      `${result.name}: ${result.score} of ${battery.answers.length} in ${result.seconds} s`,
      `${result.output ?? '?'} output tokens`,
      `prompt tokens ${result.prompts.join(' / ')} (short, questions, tool, battery)`,
      `tool call ${result.toolArgs}`,
      ...(result.signed ? ['thinking signed'] : []),
    ].join(' · ')
  );
  return result;
});
const [mine, theirs] = results;
if (mine && theirs) {
  const more = mine.prompts.filter((count, index) => count > theirs.prompts[index]).length;
  const fewer = mine.prompts.filter((count, index) => count < theirs.prompts[index]).length;
  const of = `of ${mine.prompts.length} prompts`;
  const prompts =
    [
      ...(more ? [`MORE than the maker on ${more} ${of}`] : []),
      ...(fewer ? [`fewer than the maker on ${fewer} ${of}`] : []),
    ].join(', ') || 'same';
  console.log(
    [
      `score ${mine.score >= theirs.score - 1 ? 'within one item' : 'LOWER than the maker'}`,
      `prompt tokens ${prompts}`,
      `tool call ${mine.toolArgs === theirs.toolArgs ? 'same' : 'DIFFERENT'}`,
    ].join(' · ')
  );
}
if (results.includes(undefined)) process.exitCode = 1;
