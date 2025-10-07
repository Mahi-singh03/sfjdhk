export async function POST(request) {
  try {
    const { message } = await request.json();
    if (!message || typeof message !== "string") {
      return new Response(JSON.stringify({ error: "Invalid message" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "Missing GOOGLE_API_KEY" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Import knowledge base (relative to this route file)
    const knowledgeBase = await import("../../components/skillup-knowledge.json").then((module) => module.default);

    // Resolve model/version with sane defaults that work on free API keys
    const requestedModel = (process.env.GOOGLE_MODEL || "gemini-2.0-flash").trim();

    function resolveModelAndVersion(modelId) {
      if (modelId === "gemini-pro") {
        return { model: "gemini-1.0-pro", apiVersion: "v1beta" };
      }
      if (modelId.startsWith("gemini-1.5")) {
        return { model: modelId, apiVersion: "v1" };
      }
      if (modelId.startsWith("gemini-1.0")) {
        return { model: modelId, apiVersion: "v1beta" };
      }
      return { model: modelId, apiVersion: "v1" };
    }

    // Create enhanced prompt with knowledge base
    const enhancedPrompt = `
You are an AI assistant for SkillUp Institute. Use the following knowledge base to answer questions accurately and helpfully.

KNOWLEDGE BASE:
${JSON.stringify(knowledgeBase, null, 2)}

USER QUESTION: "${message}"

INSTRUCTIONS:
1. If the question is about SkillUp Institute (courses, admissions, fees, placements, etc.), use the knowledge base to provide accurate information.
2. Be friendly, professional, and helpful.
3. If the question is not related to SkillUp Institute, politely redirect to institute-related topics.
4. For complex queries, break down information into clear points.
5. Always maintain a positive and encouraging tone.
6. If you don't know something from the knowledge base, admit it and suggest contacting the institute directly.

Please provide a helpful response:
`;

    async function listModels(targetVersion) {
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/${targetVersion}/models?key=${encodeURIComponent(apiKey)}`,
        { method: "GET" }
      );
      if (!resp.ok) return { models: [], errorText: await resp.text(), status: resp.status };
      const json = await resp.json();
      return { models: Array.isArray(json?.models) ? json.models : [] };
    }

    function pickClosestSupportedModel(models, desiredModelId) {
      const desiredBase = desiredModelId.replace(/-latest$/, "");
      const isGood = (m) => Array.isArray(m?.supportedGenerationMethods) && m.supportedGenerationMethods.includes("generateContent");
      const exact = models.find((m) => m.name?.endsWith(`/models/${desiredModelId}`) && isGood(m));
      if (exact) return desiredModelId;
      const exactLatest = models.find((m) => m.name?.endsWith(`/models/${desiredBase}-latest`) && isGood(m));
      if (exactLatest) return `${desiredBase}-latest`;
      const family = desiredBase.split("-").slice(0, 3).join("-");
      const sameFamily = models
        .filter((m) => m.name?.includes(`/models/${family}`) && isGood(m))
        .map((m) => m.name.split("/models/").pop());
      if (sameFamily.length > 0) return sameFamily[0];
      const anyGenerate = models.find(isGood);
      return anyGenerate ? anyGenerate.name.split("/models/").pop() : null;
    }

    const envVersion = process.env.GOOGLE_API_VERSION && process.env.GOOGLE_API_VERSION.trim();
    const { model, apiVersion } = envVersion
      ? { model: requestedModel, apiVersion: envVersion }
      : resolveModelAndVersion(requestedModel);

    async function callGenerateContent(targetModel, targetVersion) {
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/${targetVersion}/models/${encodeURIComponent(
          targetModel
        )}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ 
            contents: [{ 
              role: "user", 
              parts: [{ text: enhancedPrompt }] 
            }] 
          }),
        }
      );
      return resp;
    }

    // Primary attempt
    let attemptModel = model;
    let attemptVersion = apiVersion;
    let upstream = await callGenerateContent(attemptModel, attemptVersion);

    // If 404, try fallbacks: add -latest, then swap API versions
    if (!upstream.ok && upstream.status === 404) {
      const candidates = [];
      if (!attemptModel.endsWith("-latest")) {
        candidates.push({ model: `${attemptModel}-latest`, version: attemptVersion });
      }
      candidates.push({
        model: attemptModel,
        version: attemptVersion === "v1" ? "v1beta" : "v1",
      });

      for (const cand of candidates) {
        const resp = await callGenerateContent(cand.model, cand.version);
        if (resp.ok) {
          upstream = resp;
          attemptModel = cand.model;
          attemptVersion = cand.version;
          break;
        }
      }

      // If still 404 after simple fallbacks, list models and pick a compatible one
      if (!upstream.ok && upstream.status === 404) {
        const preferredOrder = [attemptVersion, attemptVersion === "v1" ? "v1beta" : "v1"];
        for (const ver of preferredOrder) {
          const { models } = await listModels(ver);
          if (models && models.length) {
            const picked = pickClosestSupportedModel(models, attemptModel);
            if (picked) {
              const tryResp = await callGenerateContent(picked, ver);
              if (tryResp.ok) {
                upstream = tryResp;
                attemptModel = picked;
                attemptVersion = ver;
                break;
              }
            }
          }
        }
      }
    }

    if (!upstream.ok) {
      const text = await upstream.text();
      console.error("Gemini upstream error", upstream.status, text);
      let maybeHint;
      if (upstream.status === 404) {
        maybeHint = {
          hint: "Model not found or unsupported for this API/version. Try GOOGLE_MODEL=gemini-1.5-flash-latest and/or GOOGLE_API_VERSION=v1. If using a Vertex AI key, switch to an AI Studio API key or update the endpoint to Vertex.",
        };
      } else if (upstream.status === 403) {
        maybeHint = {
          hint: "Permission denied. If this is a Vertex AI key, the AI Studio endpoint will not work. Use an AI Studio key for generativelanguage.googleapis.com or configure the Vertex endpoint.",
        };
      }
      return new Response(
        JSON.stringify({
          error: "Upstream error",
          status: upstream.status,
          details: text,
          model: attemptModel,
          apiVersion: attemptVersion,
          ...maybeHint,
        }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }

    const data = await upstream.json();
    const botReply =
      data?.candidates?.[0]?.content?.parts?.[0]?.text ||
      "Sorry, I couldn't understand that. Please contact SkillUp Institute directly for assistance.";

    return new Response(JSON.stringify({ reply: botReply }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Server error:", error);
    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}