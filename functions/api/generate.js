
export async function onRequestPost({ request, env }) {
  if (!env.AI) {
    return Response.json(
      { error: "Workers AI binding is not configured." },
      { status: 500 }
    );
  }

  let body;

  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Invalid JSON." },
      { status: 400 }
    );
  }

  const prompt = typeof body.prompt === "string"
    ? body.prompt.trim()
    : "";

  if (!prompt || prompt.length > 2048) {
    return Response.json(
      { error: "Enter a prompt of up to 2048 characters." },
      { status: 400 }
    );
  }

  try {
    const result = await env.AI.run(
      "@cf/black-forest-labs/flux-1-schnell",
      {
        prompt: prompt,
        steps: 4
      }
    );

    if (!result || !result.image) {
      throw new Error("No image returned.");
    }

    return Response.json({
      image: "data:image/jpeg;base64," + result.image
    });

  } catch (error) {
    return Response.json(
      { error: "Image generation failed. Please try again." },
      { status: 502 }
    );
  }
}
