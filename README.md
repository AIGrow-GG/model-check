# model-check

Is the model an API endpoint sells the one that answers?

Resellers and relays of Claude, GPT, Gemini and Grok can route a request to a cheaper model and
keep the name. `model-check.mjs` is one file with no dependencies that asks an endpoint the same
things you can ask the maker, and prints both results side by side. It works against any endpoint
that speaks OpenAI Chat Completions or Anthropic Messages.

It is the check [AIGROW](https://aigrow.gg/ai-api) runs before a model goes on sale. The results
of our own runs, with dates, are on https://aigrow.gg/ai-api/genuine-models.

## What it sends

- Twelve questions with one right answer each (number theory, a determinant, a weekday, counting).
  A smaller model gets fewer of them right.
- A two-word prompt, four short questions and a tool call. For each one the script prints the
  prompt tokens the endpoint reports, so context added in front of your prompt shows up as a
  higher count than the maker's.
- The arguments of the tool call.
- For Claude, whether the thinking block comes back signed.

## Run it

Node 18 or later.

```bash
# The endpoint alone
MODEL_CHECK_KEY=your_key node model-check.mjs claude-opus-5.5 --base https://api.example.com

# The endpoint beside the maker (Claude: an Anthropic key)
MODEL_CHECK_KEY=your_key MAKER_KEY=sk-ant-... node model-check.mjs claude-opus-5.5 --base https://api.example.com

# The endpoint beside the maker (GPT, Gemini, Grok: an OpenRouter key)
MODEL_CHECK_KEY=your_key MAKER_KEY=sk-or-... node model-check.mjs gpt-6.2-sol --base https://api.example.com
```

`--base` is the origin of the endpoint, without `/v1`. Without it the script tests
`https://aigrow.gg`. The model id is the one the endpoint lists.

## Read the result

```text
endpoint: 5 of 5 in 10 s · 435 output tokens · prompt tokens 11 / 55 / 68 / 175 (short, questions, tool, battery) · tool call {"city":"Turin","unit":"c"}
```

That line is a `--light` run of `gpt-6.2-sol` on `https://aigrow.gg`, 21 November 2026. With
`MAKER_KEY` set, a second line starts with `maker:` and a third compares the two:

```text
score within one item · prompt tokens same · tool call same
```

Three things to look at in yours:

- Score: within one item of the maker is a pass. `LOWER than the maker` is the result to
  question: run it again, then ask the seller.
- Prompt tokens: `MORE than the maker` means the endpoint puts text of its own in front of your
  prompt and bills you for it. Fewer than the maker means the endpoint takes a line's own context
  off the bill.
- Tool call: `DIFFERENT` means the arguments are not the ones the maker's model produces for
  the same request.

The script exits with code 1 when a side fails to answer.

## Options

| Option | What it does |
| --- | --- |
| `--base <url>` | Endpoint to test. Default `https://aigrow.gg`. |
| `--wire anthropic\|openai` | Protocol. Default: `anthropic` for `claude-*` ids, `openai` for the rest. |
| `--light` | Sends five of the twelve questions. |
| `--effort low\|medium\|high` | Reasoning effort of the questions on both sides (OpenAI protocol only). |
| `--max <tokens>` | Output limit of the questions on both sides. Default 32000. |
| `MAKER_BASE`, `MAKER_MODEL` | Where the maker's model is reached and under which id. Default: `api.anthropic.com` for Claude, OpenRouter for the rest. |

## Cost

Every request is billed as usual on both sides. The twelve questions are the costly part: a few
cents on most models, more on the largest ones.

## Make it yours

The questions and their answers are in the file, so a seller could tune a line to them. Change the
numbers in `ITEMS` and you have a set nobody has seen. The answers are easy to recompute with a
few lines of code.

## Licence

MIT. See [LICENSE](LICENSE).
