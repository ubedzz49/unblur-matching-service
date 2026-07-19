export interface ChatProvider {
  inferTopic(title: string, description?: string): Promise<string>;
}

const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
// Cheap, fast OpenRouter chat model -- this call just needs to turn a short doubt
// title/description into a 3-6 word subject phrase, not do any real reasoning, so we
// pick one of the least expensive general-purpose chat models available on OpenRouter.
const MODEL = "openai/gpt-4o-mini";

const SYSTEM_PROMPT =
  "You categorize a student's doubt into a short, general academic or professional subject/topic " +
  "phrase (3-6 words). Respond with ONLY the phrase, no punctuation, no quotes, no explanation. " +
  'Example: title "stuck on eigenvalues" -> "Linear Algebra" or "Eigenvalues and Eigenvectors".';

export class OpenRouterChatProvider implements ChatProvider {
  private apiKey: string;

  constructor() {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");
    this.apiKey = apiKey;
  }

  async inferTopic(title: string, description?: string): Promise<string> {
    const userContent = description ? `Title: ${title}\nDescription: ${description}` : `Title: ${title}`;

    const res = await fetch(OPENROUTER_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
        temperature: 0.2,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`chat completion request failed with status ${res.status}: ${body}`);
    }

    const data = (await res.json()) as { choices: { message: { content: string } }[] };
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error("chat completion returned no content");
    return content;
  }
}

// test-only -- deterministic, dependency-free stand-in for the real provider
export class FakeChatProvider implements ChatProvider {
  constructor(private fixedTopic?: string) {}

  async inferTopic(title: string, _description?: string): Promise<string> {
    return this.fixedTopic ?? title;
  }
}
