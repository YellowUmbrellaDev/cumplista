import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSqliteSql, type SqliteSql } from "../src/adapters/sqlite.js";
import { createApp } from "../src/app.js";
import type { Deps, Env, Mail, Mailer } from "../src/ports.js";

const APP_URL = "http://localhost:8787";

const TEST_ENV: Env = {
  APP_URL,
  SESSION_SECRET: "test-session-secret-32-bytes-long!!",
  MAIL_FROM: "Cumplista <hola@cumplista.test>",
  MAIL_DRIVER: "console",
};

class CookieJar {
  private readonly store = new Map<string, string>();

  absorb(res: Response): void {
    const rawHeaders = res.headers.getSetCookie();
    for (const header of rawHeaders) {
      const firstPart = header.split(";")[0] ?? "";
      const eqIdx = firstPart.indexOf("=");
      if (eqIdx <= 0) continue;
      const name = firstPart.slice(0, eqIdx).trim();
      const value = firstPart.slice(eqIdx + 1).trim();
      const lower = header.toLowerCase();
      if (value === "" || lower.includes("max-age=0")) {
        this.store.delete(name);
      } else {
        this.store.set(name, value);
      }
    }
  }

  header(): string {
    return Array.from(this.store.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }

  get(name: string): string | undefined {
    return this.store.get(name);
  }

  set(name: string, value: string): void {
    this.store.set(name, value);
  }
}

function formBody(fields: Record<string, string>): URLSearchParams {
  return new URLSearchParams(fields);
}

function extractManagePath(html: string): string {
  const match = /value="http:\/\/localhost:8787(\/o\/[^"]+)"/.exec(html);
  if (!match?.[1]) {
    throw new Error("manageUrl input not found in CreatedView HTML");
  }
  return match[1].replace(/&amp;/g, "&");
}

function extractListIdFromManagePath(managePath: string): string {
  const match = /^\/o\/([^?]+)/.exec(managePath);
  if (!match?.[1]) {
    throw new Error(`Could not parse listId from ${managePath}`);
  }
  return match[1];
}

function extractInviteCodeFromText(text: string): string {
  const match = /(?:code|código)\s+(\d{4})\b/.exec(text);
  if (!match?.[1]) {
    throw new Error(`4-digit code not found in text: ${text}`);
  }
  return match[1];
}

describe("Cumplista CORE slice", () => {
  let sql: SqliteSql;
  let sentMails: Mail[];
  let shouldFailMail: boolean;
  let currentNow: Date;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    sql = createSqliteSql(":memory:");
    sentMails = [];
    shouldFailMail = false;
    currentNow = new Date("2026-11-12T10:00:00.000Z");

    const mailer: Mailer = {
      async send(mail: Mail): Promise<void> {
        if (shouldFailMail) {
          throw new Error("Simulated mailer outage");
        }
        sentMails.push(mail);
      },
    };

    const deps: Deps = {
      sql,
      mailer,
      env: TEST_ENV,
      now: () => currentNow,
    };

    app = createApp(() => deps);
  });

  afterEach(() => {
    sql.close();
  });

  async function postForm(
    path: string,
    fields: Record<string, string>,
    options: { jar?: CookieJar; headers?: Record<string, string> } = {},
  ): Promise<Response> {
    const headers: Record<string, string> = {
      "content-type": "application/x-www-form-urlencoded",
      ...(options.headers ?? {}),
    };
    if (options.jar) {
      const cookie = options.jar.header();
      if (cookie) headers.cookie = cookie;
    }
    const res = await app.request(path, {
      method: "POST",
      headers,
      body: formBody(fields).toString(),
    });
    options.jar?.absorb(res);
    return res;
  }

  async function getPage(
    path: string,
    options: { jar?: CookieJar; headers?: Record<string, string> } = {},
  ): Promise<Response> {
    const headers: Record<string, string> = { ...(options.headers ?? {}) };
    if (options.jar) {
      const cookie = options.jar.header();
      if (cookie) headers.cookie = cookie;
    }
    const res = await app.request(path, { method: "GET", headers });
    options.jar?.absorb(res);
    return res;
  }

  async function setupAuthenticatedOwnerList(
    overrides: Partial<{
      title: string;
      ownerName: string;
      ownerEmail: string;
      occasionDate: string;
    }> = {},
    ownerJar = new CookieJar(),
  ): Promise<{ listId: string; managePath: string; ownerJar: CookieJar }> {
    const createRes = await postForm(
      "/lists",
      {
        title: overrides.title ?? "Nerea's 30th Birthday",
        ownerName: overrides.ownerName ?? "Nerea",
        ownerEmail: overrides.ownerEmail ?? "nerea@example.com",
        occasionDate: overrides.occasionDate ?? "2026-11-22",
      },
      { jar: ownerJar },
    );
    expect(createRes.status).toBe(200);
    const createdHtml = await createRes.text();
    const managePath = extractManagePath(createdHtml);
    const listId = extractListIdFromManagePath(managePath);

    const exchangeRes = await getPage(managePath, { jar: ownerJar });
    expect(exchangeRes.status).toBe(302);
    expect(exchangeRes.headers.get("location")).toBe(`/o/${listId}`);

    return { listId, managePath, ownerJar };
  }

  it("responds ok on /healthz", async () => {
    const res = await getPage("/healthz");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("creates a list, emails the owner link, and exchanges token for a signed owner cookie", async () => {
    const ownerJar = new CookieJar();
    const createRes = await postForm(
      "/lists",
      {
        title: "Birthday Wishes",
        ownerName: "Lucia",
        ownerEmail: "lucia@example.com",
        occasionDate: "2026-11-22",
      },
      { jar: ownerJar },
    );

    expect(createRes.status).toBe(200);
    const createdHtml = await createRes.text();
    const managePath = extractManagePath(createdHtml);
    const listId = extractListIdFromManagePath(managePath);

    expect(sentMails).toHaveLength(1);
    expect(sentMails[0]?.to).toBe("lucia@example.com");
    expect(sentMails[0]?.subject).toBe('Your gift list "Birthday Wishes" is ready');
    expect(sentMails[0]?.text).toContain(`${APP_URL}${managePath}`);

    const unauthRes = await getPage(`/o/${listId}`);
    expect(unauthRes.status).toBe(403);

    const wrongTokenRes = await getPage(`/o/${listId}?k=wrong-token-value`);
    expect(wrongTokenRes.status).toBe(403);

    const exchangeRes = await getPage(managePath, { jar: ownerJar });
    expect(exchangeRes.status).toBe(302);
    expect(exchangeRes.headers.get("location")).toBe(`/o/${listId}`);
    const setCookieHeader = exchangeRes.headers.getSetCookie()[0] ?? "";
    expect(setCookieHeader).toContain(`o_${listId}=`);
    expect(setCookieHeader).toContain("HttpOnly");
    expect(setCookieHeader).toContain("SameSite=Lax");
    expect(setCookieHeader).toContain("Path=/");

    const ownerPageRes = await getPage(`/o/${listId}`, { jar: ownerJar });
    expect(ownerPageRes.status).toBe(200);
    const ownerHtml = await ownerPageRes.text();
    expect(ownerHtml).toContain("Birthday Wishes");
    expect(ownerHtml).toContain("10 days left");

    const tamperedJar = new CookieJar();
    tamperedJar.set(`o_${listId}`, `${ownerJar.get(`o_${listId}`) ?? ""}tampered`);
    const tamperedRes = await getPage(`/o/${listId}`, { jar: tamperedJar });
    expect(tamperedRes.status).toBe(403);
  });

  it("validates list creation and handles mail failure without failing the request", async () => {
    const badDateRes = await postForm("/lists", {
      title: "Party",
      ownerName: "Ana",
      ownerEmail: "ana@example.com",
      occasionDate: "2026-02-30",
    });
    expect(badDateRes.status).toBe(400);
    expect(await badDateRes.text()).toContain("Check the highlighted fields and try again.");

    shouldFailMail = true;
    const mailFailRes = await postForm("/lists", {
      title: "Resilient List",
      ownerName: "Ana",
      ownerEmail: "ana@example.com",
      occasionDate: "",
    });
    expect(mailFailRes.status).toBe(200);
    const html = await mailFailRes.text();
    expect(html).toContain("The email could not be delivered right now.");
    expect(extractManagePath(html)).toMatch(/^\/o\/[A-Za-z0-9_-]+\?k=/);
  });

  it("supports adding, editing, reordering, and deleting items with validated prices and urls", async () => {
    const { listId, ownerJar } = await setupAuthenticatedOwnerList();

    const badUrlRes = await postForm(
      `/o/${listId}/items`,
      { name: "XSS Link", price: "10", url: "javascript:alert(1)", details: "" },
      { jar: ownerJar },
    );
    expect(badUrlRes.status).toBe(400);

    const badPriceRes = await postForm(
      `/o/${listId}/items`,
      { name: "Negative Item", price: "-12.00", url: "", details: "" },
      { jar: ownerJar },
    );
    expect(badPriceRes.status).toBe(400);

    expect(
      (
        await postForm(
          `/o/${listId}/items`,
          {
            name: "Ceramic Mug",
            price: "24.50",
            url: "https://shop.example.com/mug",
            details: "Speckled glaze",
          },
          { jar: ownerJar },
        )
      ).status,
    ).toBe(302);

    expect(
      (
        await postForm(
          `/o/${listId}/items`,
          {
            name: "Wool Scarf",
            price: "35,49",
            url: "https://shop.example.com/scarf",
            details: "Forest green",
          },
          { jar: ownerJar },
        )
      ).status,
    ).toBe(302);

    expect(
      (
        await postForm(
          `/o/${listId}/items`,
          {
            name: "Hardcover Novel",
            price: "18",
            url: "",
            details: "",
          },
          { jar: ownerJar },
        )
      ).status,
    ).toBe(302);

    const listRes1 = await getPage(`/o/${listId}`, { jar: ownerJar });
    const html1 = await listRes1.text();
    expect(html1).toContain("$77.99");

    const itemIds = Array.from(html1.matchAll(/<li id="item-([^"]+)"/g), (m) => m[1] ?? "");
    expect(itemIds).toHaveLength(3);
    const [mugId, scarfId, novelId] = itemIds;
    if (!mugId || !scarfId || !novelId) throw new Error("Expected 3 item IDs");

    const moveRes = await postForm(
      `/o/${listId}/items/${novelId}/move`,
      { direction: "up" },
      { jar: ownerJar },
    );
    expect(moveRes.status).toBe(302);

    const htmlAfterUp = await (await getPage(`/o/${listId}`, { jar: ownerJar })).text();
    expect(
      Array.from(htmlAfterUp.matchAll(/<li id="item-([^"]+)"/g), (m) => m[1]),
    ).toEqual([mugId, novelId, scarfId]);

    await postForm(
      `/o/${listId}/items/${mugId}/move`,
      { direction: "down" },
      { jar: ownerJar },
    );
    const htmlAfterDown = await (await getPage(`/o/${listId}`, { jar: ownerJar })).text();
    expect(
      Array.from(htmlAfterDown.matchAll(/<li id="item-([^"]+)"/g), (m) => m[1]),
    ).toEqual([novelId, mugId, scarfId]);

    const editRes = await postForm(
      `/o/${listId}/items/${mugId}`,
      {
        name: "Handmade Ceramic Mug",
        price: "30.00",
        url: "https://shop.example.com/handmade-mug",
        details: "Cobalt blue",
      },
      { jar: ownerJar },
    );
    expect(editRes.status).toBe(302);

    const deleteRes = await postForm(
      `/o/${listId}/items/${scarfId}/delete`,
      {},
      { jar: ownerJar },
    );
    expect(deleteRes.status).toBe(302);

    const finalHtml = await (await getPage(`/o/${listId}`, { jar: ownerJar })).text();
    expect(finalHtml).toContain("Handmade Ceramic Mug");
    expect(finalHtml).toContain("Cobalt blue");
    expect(finalHtml).not.toContain("Wool Scarf");
    expect(finalHtml).toContain("$48.00");
  });

  it("invites guests with mail and share links containing both list URL and 4-digit code", async () => {
    const { listId, ownerJar } = await setupAuthenticatedOwnerList({
      title: "Fiesta 30",
      ownerName: "Marta",
    });
    sentMails.length = 0;

    const addEmailGuest = await postForm(
      `/o/${listId}/guests`,
      { name: "Pablo", email: "pablo@example.com" },
      { jar: ownerJar },
    );
    expect(addEmailGuest.status).toBe(302);
    expect(addEmailGuest.headers.get("location")).toBe(`/o/${listId}?flash=guest-added`);

    expect(sentMails).toHaveLength(1);
    const inviteMail = sentMails[0];
    if (!inviteMail) throw new Error("Expected invite mail");
    expect(inviteMail.to).toBe("pablo@example.com");
    expect(inviteMail.subject).toBe("Marta invited you to a gift list");
    expect(inviteMail.text).toContain(`${APP_URL}/l/${listId}`);
    const pabloCode = extractInviteCodeFromText(inviteMail.text);
    expect(pabloCode).toMatch(/^\d{4}$/);
    expect(inviteMail.html).toContain(`${APP_URL}/l/${listId}`);
    expect(inviteMail.html).toContain(pabloCode);

    const addShareOnlyGuest = await postForm(
      `/o/${listId}/guests`,
      { name: "Elena", email: "" },
      { jar: ownerJar },
    );
    expect(addShareOnlyGuest.status).toBe(302);
    expect(sentMails).toHaveLength(1);

    const ownerHtml = await (await getPage(`/o/${listId}`, { jar: ownerJar })).text();
    expect(ownerHtml).toContain("https://wa.me/?text=");
    expect(ownerHtml).toContain("https://t.me/share/url?url=");
    expect(ownerHtml).toContain("mailto:");
    expect(ownerHtml).toContain(encodeURIComponent(`${APP_URL}/l/${listId}`));
    expect(ownerHtml).toContain(pabloCode);

    const pabloIdMatch = /<li id="guest-([^"]+)"/.exec(ownerHtml);
    const pabloId = pabloIdMatch?.[1];
    if (!pabloId) throw new Error("Guest row id missing");

    const regenRes = await postForm(`/o/${listId}/guests/${pabloId}/code`, {}, { jar: ownerJar });
    expect(regenRes.status).toBe(302);
    expect(sentMails).toHaveLength(2);
    const newCode = extractInviteCodeFromText(sentMails[1]?.text ?? "");
    expect(newCode).not.toBe(pabloCode);

    const oldCodeJoin = await postForm(`/l/${listId}/join`, { code: pabloCode });
    expect(oldCodeJoin.status).toBe(401);

    const guestJar = new CookieJar();
    const newCodeJoin = await postForm(`/l/${listId}/join`, { code: newCode }, { jar: guestJar });
    expect(newCodeJoin.status).toBe(302);
    expect(newCodeJoin.headers.get("location")).toBe(`/l/${listId}/list`);
  });

  it("joins with valid code, rejects wrong codes, and throttles after 8 failures in 10 minutes", async () => {
    const { listId, ownerJar } = await setupAuthenticatedOwnerList();
    sentMails.length = 0;

    await postForm(
      `/o/${listId}/guests`,
      { name: "Diego", email: "diego@example.com" },
      { jar: ownerJar },
    );
    const code = extractInviteCodeFromText(sentMails[0]?.text ?? "");
    const wrongCode = code === "0000" ? "9999" : "0000";

    const joinGet = await getPage(`/l/${listId}`);
    expect(joinGet.status).toBe(200);

    for (let i = 0; i < 8; i++) {
      const wrongRes = await postForm(
        `/l/${listId}/join`,
        { code: wrongCode },
        { headers: { "x-forwarded-for": "203.0.113.10" } },
      );
      expect(wrongRes.status).toBe(401);
      expect(await wrongRes.text()).toContain("That code does not match.");
    }

    const throttledRes = await postForm(
      `/l/${listId}/join`,
      { code },
      { headers: { "x-forwarded-for": "203.0.113.10" } },
    );
    expect(throttledRes.status).toBe(429);
    expect(await throttledRes.text()).toContain("Too many wrong codes.");

    const otherIpJar = new CookieJar();
    const otherIpJoin = await postForm(
      `/l/${listId}/join`,
      { code },
      { jar: otherIpJar, headers: { "x-forwarded-for": "203.0.113.99" } },
    );
    expect(otherIpJoin.status).toBe(302);
    expect(otherIpJoin.headers.get("location")).toBe(`/l/${listId}/list`);
    expect(otherIpJar.get(`g_${listId}`)).toBeTruthy();

    const revisitJoin = await getPage(`/l/${listId}`, { jar: otherIpJar });
    expect(revisitJoin.status).toBe(302);
    expect(revisitJoin.headers.get("location")).toBe(`/l/${listId}/list`);

    currentNow = new Date(currentNow.getTime() + 11 * 60 * 1000);
    const expiredWindowJar = new CookieJar();
    const afterCooldownRes = await postForm(
      `/l/${listId}/join`,
      { code },
      { jar: expiredWindowJar, headers: { "x-forwarded-for": "203.0.113.10" } },
    );
    expect(afterCooldownRes.status).toBe(302);
  });

  it("handles claim, unclaim, taken state with claimer name, and concurrent double-claim race", async () => {
    const { listId, ownerJar } = await setupAuthenticatedOwnerList();
    await postForm(
      `/o/${listId}/items`,
      { name: "Espresso Machine", price: "199.00", url: "", details: "" },
      { jar: ownerJar },
    );
    await postForm(
      `/o/${listId}/items`,
      { name: "Cast Iron Skillet", price: "45.00", url: "", details: "" },
      { jar: ownerJar },
    );

    const ownerHtml = await (await getPage(`/o/${listId}`, { jar: ownerJar })).text();
    const [item1Id, item2Id] = Array.from(
      ownerHtml.matchAll(/<li id="item-([^"]+)"/g),
      (m) => m[1] ?? "",
    );
    if (!item1Id || !item2Id) throw new Error("Missing item IDs");

    sentMails.length = 0;
    await postForm(
      `/o/${listId}/guests`,
      { name: "Alice", email: "alice@example.com" },
      { jar: ownerJar },
    );
    await postForm(
      `/o/${listId}/guests`,
      { name: "Bruno", email: "bruno@example.com" },
      { jar: ownerJar },
    );
    const aliceCode = extractInviteCodeFromText(sentMails[0]?.text ?? "");
    const brunoCode = extractInviteCodeFromText(sentMails[1]?.text ?? "");

    const aliceJar = new CookieJar();
    const brunoJar = new CookieJar();
    await postForm(`/l/${listId}/join`, { code: aliceCode }, { jar: aliceJar });
    await postForm(`/l/${listId}/join`, { code: brunoCode }, { jar: brunoJar });

    const claimRes = await postForm(
      `/l/${listId}/items/${item1Id}/claim`,
      {},
      { jar: aliceJar },
    );
    expect(claimRes.status).toBe(302);
    expect(claimRes.headers.get("location")).toBe(`/l/${listId}/list#item-${item1Id}`);

    const aliceListHtml = await (await getPage(`/l/${listId}/list`, { jar: aliceJar })).text();
    expect(aliceListHtml).toContain(`id="item-${item1Id}" class="gift-row is-mine"`);

    const brunoListHtml = await (await getPage(`/l/${listId}/list`, { jar: brunoJar })).text();
    expect(brunoListHtml).toContain(`id="item-${item1Id}" class="gift-row is-wrapped"`);
    expect(brunoListHtml).toContain("Espresso Machine, wrapped gift claimed by Alice");
    expect(brunoListHtml).toContain(">Alice<");

    await postForm(`/l/${listId}/items/${item1Id}/unclaim`, {}, { jar: brunoJar });
    const brunoAfterForeignUnclaim = await (
      await getPage(`/l/${listId}/list`, { jar: brunoJar })
    ).text();
    expect(brunoAfterForeignUnclaim).toContain("Espresso Machine, wrapped gift claimed by Alice");

    const unclaimRes = await postForm(
      `/l/${listId}/items/${item1Id}/unclaim`,
      {},
      { jar: aliceJar },
    );
    expect(unclaimRes.status).toBe(302);
    const brunoAfterUnclaim = await (await getPage(`/l/${listId}/list`, { jar: brunoJar })).text();
    expect(brunoAfterUnclaim).toContain(`id="item-${item1Id}" class="gift-row is-free"`);

    const [raceA, raceB] = await Promise.all([
      postForm(`/l/${listId}/items/${item2Id}/claim`, {}, { jar: aliceJar }),
      postForm(`/l/${listId}/items/${item2Id}/claim`, {}, { jar: brunoJar }),
    ]);

    const statuses = [raceA.status, raceB.status].sort((a, b) => a - b);
    expect(statuses).toEqual([302, 409]);

    const conflictRes = raceA.status === 409 ? raceA : raceB;
    expect(await conflictRes.text()).toContain("Someone else just took that gift.");
  });

  it("prevents claiming or unclaiming an item marked as received by the owner", async () => {
    const { listId, ownerJar } = await setupAuthenticatedOwnerList();
    await postForm(
      `/o/${listId}/items`,
      { name: "Desk Lamp", price: "60.00", url: "", details: "" },
      { jar: ownerJar },
    );
    await postForm(
      `/o/${listId}/items`,
      { name: "Board Game", price: "40.00", url: "", details: "" },
      { jar: ownerJar },
    );

    const ownerHtml = await (await getPage(`/o/${listId}`, { jar: ownerJar })).text();
    const [lampId, gameId] = Array.from(
      ownerHtml.matchAll(/<li id="item-([^"]+)"/g),
      (m) => m[1] ?? "",
    );
    if (!lampId || !gameId) throw new Error("Missing item IDs");

    sentMails.length = 0;
    await postForm(
      `/o/${listId}/guests`,
      { name: "Carla", email: "carla@example.com" },
      { jar: ownerJar },
    );
    const carlaCode = extractInviteCodeFromText(sentMails[0]?.text ?? "");
    const carlaJar = new CookieJar();
    await postForm(`/l/${listId}/join`, { code: carlaCode }, { jar: carlaJar });

    await postForm(`/o/${listId}/items/${lampId}/received`, { received: "1" }, { jar: ownerJar });

    const claimReceivedRes = await postForm(
      `/l/${listId}/items/${lampId}/claim`,
      {},
      { jar: carlaJar },
    );
    expect(claimReceivedRes.status).toBe(409);

    expect(
      (await postForm(`/l/${listId}/items/${gameId}/claim`, {}, { jar: carlaJar })).status,
    ).toBe(302);

    await postForm(`/o/${listId}/items/${gameId}/received`, { received: "1" }, { jar: ownerJar });

    const unclaimReceivedRes = await postForm(
      `/l/${listId}/items/${gameId}/unclaim`,
      {},
      { jar: carlaJar },
    );
    expect(unclaimReceivedRes.status).toBe(409);

    await postForm(`/o/${listId}/items/${gameId}/received`, {}, { jar: ownerJar });
    expect(
      (await postForm(`/l/${listId}/items/${gameId}/unclaim`, {}, { jar: carlaJar })).status,
    ).toBe(302);
  });

  it("lets guests manage only their own ideas, enforces the 50-idea cap, and cascades on guest removal", async () => {
    const { listId, ownerJar } = await setupAuthenticatedOwnerList();
    await postForm(
      `/o/${listId}/items`,
      { name: "Record Player", price: "150", url: "", details: "" },
      { jar: ownerJar },
    );

    sentMails.length = 0;
    await postForm(
      `/o/${listId}/guests`,
      { name: "Sofia", email: "sofia@example.com" },
      { jar: ownerJar },
    );
    await postForm(
      `/o/${listId}/guests`,
      { name: "Mateo", email: "mateo@example.com" },
      { jar: ownerJar },
    );
    const sofiaCode = extractInviteCodeFromText(sentMails[0]?.text ?? "");
    const mateoCode = extractInviteCodeFromText(sentMails[1]?.text ?? "");

    const ownerHtml = await (await getPage(`/o/${listId}`, { jar: ownerJar })).text();
    const itemId = /<li id="item-([^"]+)"/.exec(ownerHtml)?.[1] ?? "";
    const sofiaGuestId = /<li id="guest-([^"]+)"/.exec(ownerHtml)?.[1] ?? "";
    expect(itemId).not.toBe("");
    expect(sofiaGuestId).not.toBe("");

    const sofiaJar = new CookieJar();
    const mateoJar = new CookieJar();
    await postForm(`/l/${listId}/join`, { code: sofiaCode }, { jar: sofiaJar });
    await postForm(`/l/${listId}/join`, { code: mateoCode }, { jar: mateoJar });

    await postForm(`/l/${listId}/items/${itemId}/claim`, {}, { jar: sofiaJar });

    const addIdeaRes = await postForm(
      `/l/${listId}/ideas`,
      {
        name: "Concert Tickets",
        price: "85.00",
        url: "https://tickets.example.com/show",
        details: "Two front row seats",
      },
      { jar: sofiaJar },
    );
    expect(addIdeaRes.status).toBe(302);

    const mateoViewHtml = await (await getPage(`/l/${listId}/list`, { jar: mateoJar })).text();
    expect(mateoViewHtml).toContain("Concert Tickets");
    expect(mateoViewHtml).toContain("From Sofia");
    expect(mateoViewHtml).toContain("Two front row seats");

    const ideaId = /<li id="idea-([^"]+)"/.exec(mateoViewHtml)?.[1] ?? "";
    expect(ideaId).not.toBe("");

    const foreignEditRes = await postForm(
      `/l/${listId}/ideas/${ideaId}`,
      { name: "Hijacked Gift", price: "1.00", url: "", details: "" },
      { jar: mateoJar },
    );
    expect(foreignEditRes.status).toBe(404);

    const foreignDeleteRes = await postForm(
      `/l/${listId}/ideas/${ideaId}/delete`,
      {},
      { jar: mateoJar },
    );
    expect(foreignDeleteRes.status).toBe(404);

    const ownEditRes = await postForm(
      `/l/${listId}/ideas/${ideaId}`,
      {
        name: "VIP Concert Tickets",
        price: "110.00",
        url: "https://tickets.example.com/vip",
        details: "Backstage pass",
      },
      { jar: sofiaJar },
    );
    expect(ownEditRes.status).toBe(302);

    const mateoAfterEdit = await (await getPage(`/l/${listId}/list`, { jar: mateoJar })).text();
    expect(mateoAfterEdit).toContain("VIP Concert Tickets");
    expect(mateoAfterEdit).not.toContain("Hijacked Gift");

    for (let i = 1; i < 50; i++) {
      const r = await postForm(
        `/l/${listId}/ideas`,
        { name: `Extra Idea ${i}`, price: "", url: "", details: "" },
        { jar: sofiaJar },
      );
      expect(r.status).toBe(302);
    }
    const overCapRes = await postForm(
      `/l/${listId}/ideas`,
      { name: "Idea 51", price: "", url: "", details: "" },
      { jar: sofiaJar },
    );
    expect(overCapRes.status).toBe(400);

    const removeRes = await postForm(
      `/o/${listId}/guests/${sofiaGuestId}/delete`,
      {},
      { jar: ownerJar },
    );
    expect(removeRes.status).toBe(302);

    const mateoAfterRemoval = await (await getPage(`/l/${listId}/list`, { jar: mateoJar })).text();
    expect(mateoAfterRemoval).toContain(`id="item-${itemId}" class="gift-row is-free"`);
    expect(mateoAfterRemoval).not.toContain("VIP Concert Tickets");
    expect(mateoAfterRemoval).not.toContain("From Sofia");

    const sofiaAfterRemoval = await getPage(`/l/${listId}/list`, { jar: sofiaJar });
    expect(sofiaAfterRemoval.status).toBe(302);
    expect(sofiaAfterRemoval.headers.get("location")).toBe(`/l/${listId}`);
  });

  it("switches locale via cookie, respects Accept-Language, and localizes list invites", async () => {
    const defaultHome = await getPage("/");
    expect(await defaultHome.text()).toContain('<html lang="en">');

    const acceptEsHome = await getPage("/", {
      headers: { "accept-language": "es-ES,es;q=0.9,en;q=0.8" },
    });
    expect(await acceptEsHome.text()).toContain('<html lang="es">');

    const jar = new CookieJar();
    const switchRes = await postForm("/lang", { lang: "es", back: "/" }, { jar });
    expect(switchRes.status).toBe(302);
    expect(switchRes.headers.get("location")).toBe("/");

    const cookieOverridesHeader = await getPage("/", {
      jar,
      headers: { "accept-language": "en-US,en;q=0.9" },
    });
    expect(await cookieOverridesHeader.text()).toContain('<html lang="es">');

    const unsafeBackRes = await postForm(
      "/lang",
      { lang: "en", back: "//evil.example/phish" },
      { jar },
    );
    expect(unsafeBackRes.headers.get("location")).toBe("/");

    await postForm("/lang", { lang: "es", back: "/" }, { jar });
    sentMails.length = 0;
    const { listId } = await setupAuthenticatedOwnerList(
      { title: "Cumple de Hugo", ownerName: "Hugo" },
      jar,
    );
    expect(sentMails[0]?.subject).toBe('Tu lista de regalos "Cumple de Hugo" está lista');

    await postForm(
      `/o/${listId}/guests`,
      { name: "Ines", email: "ines@example.com" },
      { jar },
    );
    expect(sentMails[1]?.text).toContain(
      'Hugo te invita a su lista de regalos de cumpleaños "Cumple de Hugo".',
    );
  });

  it("rejects POST mutations with a foreign or null Origin header", async () => {
    const evilOriginRes = await postForm(
      "/lists",
      {
        title: "CSRF Attempt",
        ownerName: "Mallory",
        ownerEmail: "mallory@example.com",
        occasionDate: "",
      },
      { headers: { origin: "https://evil.example" } },
    );
    expect(evilOriginRes.status).toBe(403);

    const nullOriginRes = await postForm(
      "/lists",
      {
        title: "Sandboxed Attempt",
        ownerName: "Mallory",
        ownerEmail: "mallory@example.com",
        occasionDate: "",
      },
      { headers: { origin: "null" } },
    );
    expect(nullOriginRes.status).toBe(403);

    const matchingOriginRes = await postForm(
      "/lists",
      {
        title: "Legit List",
        ownerName: "Nerea",
        ownerEmail: "nerea@example.com",
        occasionDate: "",
      },
      { headers: { origin: APP_URL } },
    );
    expect(matchingOriginRes.status).toBe(200);
  });

  it("PRIVACY INVARIANT: leaks zero claim or side-gift data across every owner route", async () => {
    const { listId, managePath, ownerJar } = await setupAuthenticatedOwnerList({
      title: "Privacy Audit List",
      ownerName: "OwnerPerson",
    });

    await postForm(
      `/o/${listId}/items`,
      { name: "Fountain Pen", price: "55.00", url: "https://pens.example.com/1", details: "Fine nib" },
      { jar: ownerJar },
    );
    await postForm(
      `/o/${listId}/items`,
      { name: "Desk Organizer", price: "32.00", url: "", details: "Walnut" },
      { jar: ownerJar },
    );

    sentMails.length = 0;
    await postForm(
      `/o/${listId}/guests`,
      { name: "VictorClaimer", email: "victor@example.com" },
      { jar: ownerJar },
    );
    await postForm(
      `/o/${listId}/guests`,
      { name: "ZoeIdeaMaker", email: "zoe@example.com" },
      { jar: ownerJar },
    );
    const victorCode = extractInviteCodeFromText(sentMails[0]?.text ?? "");
    const zoeCode = extractInviteCodeFromText(sentMails[1]?.text ?? "");

    const victorJar = new CookieJar();
    const zoeJar = new CookieJar();
    await postForm(`/l/${listId}/join`, { code: victorCode }, { jar: victorJar });
    await postForm(`/l/${listId}/join`, { code: zoeCode }, { jar: zoeJar });

    const ownerHtmlBaseline = await (await getPage(`/o/${listId}`, { jar: ownerJar })).text();
    const [penId, organizerId] = Array.from(
      ownerHtmlBaseline.matchAll(/<li id="item-([^"]+)"/g),
      (m) => m[1] ?? "",
    );
    const guestIds = Array.from(
      ownerHtmlBaseline.matchAll(/<li id="guest-([^"]+)"/g),
      (m) => m[1] ?? "",
    );
    if (!penId || !organizerId || guestIds.length < 2) {
      throw new Error("Expected 2 items and 2 guests");
    }

    expect(
      (await postForm(`/l/${listId}/items/${penId}/claim`, {}, { jar: victorJar })).status,
    ).toBe(302);
    expect(
      (
        await postForm(
          `/l/${listId}/ideas`,
          {
            name: "UltraSecretTelescope",
            price: "739.42",
            url: "https://astronomy-secret.example/scope",
            details: "Dobsonian mount surprise",
          },
          { jar: zoeJar },
        )
      ).status,
    ).toBe(302);

    const zoeListCheck = await (await getPage(`/l/${listId}/list`, { jar: zoeJar })).text();
    expect(zoeListCheck).toContain("Fountain Pen, wrapped gift claimed by VictorClaimer");
    expect(zoeListCheck).toContain("UltraSecretTelescope");
    expect(zoeListCheck).toContain("739.42");

    const ownerHtmlAfterSecrets = await (await getPage(`/o/${listId}`, { jar: ownerJar })).text();
    expect(ownerHtmlAfterSecrets).toBe(ownerHtmlBaseline);

    const forbiddenMarkers = [
      "UltraSecretTelescope",
      "739.42",
      "739,42",
      "73942",
      "astronomy-secret.example",
      "Dobsonian mount surprise",
      "Claimed by",
      "claimed by",
      "wrapped gift",
      "is-wrapped",
      "is-taken",
      "is-mine",
      "gift-tag",
      "ideas-section",
      "idea-row",
      "side-gift",
      "side_gift",
      "From ZoeIdeaMaker",
      "From VictorClaimer",
    ];

    const assertCleanOwnerResponse = async (res: Response): Promise<string> => {
      const body = await res.text();
      const location = res.headers.get("location") ?? "";
      for (const marker of forbiddenMarkers) {
        expect(body).not.toContain(marker);
        expect(location).not.toContain(marker);
      }
      const wishesSlice = body.split('id="guests-heading"')[0] ?? "";
      if (wishesSlice && body.includes('id="wishes-heading"')) {
        expect(wishesSlice).not.toContain("VictorClaimer");
        expect(wishesSlice).not.toContain("ZoeIdeaMaker");
      }
      return body;
    };

    await assertCleanOwnerResponse(await getPage(managePath, { jar: ownerJar }));
    await assertCleanOwnerResponse(await getPage(`/o/${listId}`, { jar: ownerJar }));
    await assertCleanOwnerResponse(
      await postForm(`/o/${listId}/items`, { name: "", price: "bad", url: "", details: "" }, { jar: ownerJar }),
    );
    await assertCleanOwnerResponse(
      await postForm(
        `/o/${listId}/items`,
        { name: "Tea Kettle", price: "28.00", url: "", details: "" },
        { jar: ownerJar },
      ),
    );
    await assertCleanOwnerResponse(
      await postForm(
        `/o/${listId}/items/${penId}`,
        { name: "Gold Fountain Pen", price: "58.00", url: "https://pens.example.com/1", details: "Medium nib" },
        { jar: ownerJar },
      ),
    );
    await assertCleanOwnerResponse(
      await postForm(`/o/${listId}/items/${penId}/received`, { received: "1" }, { jar: ownerJar }),
    );
    await assertCleanOwnerResponse(
      await postForm(`/o/${listId}/items/${organizerId}/move`, { direction: "up" }, { jar: ownerJar }),
    );
    await assertCleanOwnerResponse(
      await postForm(`/o/${listId}/items/${organizerId}/delete`, {}, { jar: ownerJar }),
    );
    await assertCleanOwnerResponse(
      await postForm(
        `/o/${listId}/guests`,
        { name: "ExtraGuest", email: "" },
        { jar: ownerJar },
      ),
    );
    await assertCleanOwnerResponse(
      await postForm(`/o/${listId}/guests/${guestIds[0] ?? ""}/code`, {}, { jar: ownerJar }),
    );
    await assertCleanOwnerResponse(
      await postForm(`/o/${listId}/guests/${guestIds[0] ?? ""}/delete`, {}, { jar: ownerJar }),
    );
    await assertCleanOwnerResponse(
      await postForm(`/o/${listId}/guests/${guestIds[1] ?? ""}/delete`, {}, { jar: ownerJar }),
    );

    const finalOwnerRes = await getPage(`/o/${listId}`, { jar: ownerJar });
    const finalBody = await assertCleanOwnerResponse(finalOwnerRes);
    expect(finalBody).not.toContain("VictorClaimer");
    expect(finalBody).not.toContain("ZoeIdeaMaker");
  });

  it("enforces the 200-guest per-list cap with unique 4-digit invite codes", async () => {
    const { listId, ownerJar } = await setupAuthenticatedOwnerList();

    for (let i = 0; i < 200; i++) {
      const res = await postForm(
        `/o/${listId}/guests`,
        { name: `Guest ${i}`, email: "" },
        { jar: ownerJar },
      );
      expect(res.status).toBe(302);
    }

    const overCap = await postForm(
      `/o/${listId}/guests`,
      { name: "Guest 201", email: "" },
      { jar: ownerJar },
    );
    expect(overCap.status).toBe(400);

    const ownerHtml = await (await getPage(`/o/${listId}`, { jar: ownerJar })).text();
    const codes = Array.from(ownerHtml.matchAll(/Code (\d{4})/g), (m) => m[1] ?? "");
    expect(codes).toHaveLength(200);
    expect(new Set(codes).size).toBe(200);
  });
});
