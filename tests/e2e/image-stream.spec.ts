import { expect, test } from "./fixtures";

test("image operation streams report failures in a final frame without claiming creation", async ({
  page,
}) => {
  await page.goto("/cms/");

  const results = await page.evaluate(async () => {
    const token = document.querySelector<HTMLMetaElement>(
      'meta[name="local-cms-token"]',
    )!.content;
    const bootstrap = (await fetch("/api/local-cms/bootstrap").then(
      (response) => response.json(),
    )) as { posts: Array<{ folder: string }> };
    const image = {
      filename: "broken.png",
      mimeType: "image/png",
      base64: "bm90IGFuIGltYWdl",
      alt: "Broken image",
    };
    const requests = [
      {
        path: "/api/local-cms/images",
        input: {
          folder: bootstrap.posts[0].folder,
          layout: "single",
          images: [image],
        },
      },
      {
        path: "/api/local-cms/library/images",
        input: { images: [image] },
      },
    ];

    return Promise.all(
      requests.map(async ({ path, input }) => {
        const response = await fetch(path, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Local-CMS-Token": token,
          },
          body: JSON.stringify(input),
        });
        return { status: response.status, body: await response.text() };
      }),
    );
  });

  expect(results.map((result) => result.status)).toEqual([200, 200]);
  for (const result of results) {
    const messages = result.body
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { type: string; error?: string });
    expect(messages.at(-1)).toEqual({
      type: "error",
      error: expect.any(String),
    });
  }
});
