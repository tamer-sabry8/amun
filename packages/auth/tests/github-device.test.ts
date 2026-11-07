import { expect, it, vi } from "vitest";
import { GithubDeviceLogin } from "../src/github-device.ts";
const challenge = {
  verification_uri: "https://github.com/login/device",
  user_code: "ABCD-EFGH",
  device_code: "a".repeat(40),
  interval: 5,
  expires_in: 900,
};
function setup(responses: unknown[]) {
  let now = 1000;
  const post = vi.fn(async () => responses.shift()),
    open = vi.fn(async () => {}),
    save = vi.fn();
  return {
    login: new GithubDeviceLogin(post, open, save, () => now),
    post,
    open,
    save,
    tick: (ms: number) => {
      now += ms;
    },
  };
}
it("shows only the user code, opens the trusted page, and saves a scoped token only after consent", async () => {
  const s = setup([
    challenge,
    { error: "slow_down" },
    {
      access_token: "test-only",
      token_type: "bearer",
      scope: "public_repo",
      expires_in: 300,
    },
  ]);
  expect(await s.login.start()).toBe(challenge.user_code);
  expect(s.open).not.toHaveBeenCalled();
  expect(await s.login.start()).toBe(challenge.user_code);
  expect(s.post).toHaveBeenCalledTimes(1);
  await s.login.openBrowser();
  expect(s.open).toHaveBeenCalledOnce();
  expect(await s.login.check()).toBe("pending");
  s.tick(5000);
  expect(await s.login.check()).toBe("pending");
  s.tick(5000);
  expect(await s.login.check()).toBe("pending");
  s.tick(5000);
  expect(await s.login.check()).toBe("authorized");
  expect(s.save).toHaveBeenCalledOnce();
});
it("refuses alternate sign-in pages, cancelled, expired, or excessive grants", async () => {
  const bad = setup([
    { ...challenge, verification_uri: "https://example.org" },
  ]);
  await expect(bad.login.start()).rejects.toThrow();
  expect(bad.open).not.toHaveBeenCalled();
  for (const mode of ["cancel", "expire", "scope"]) {
    const s = setup([
      challenge,
      { access_token: "fixture", token_type: "bearer", scope: "repo" },
    ]);
    await s.login.start();
    if (mode === "cancel") s.login.cancel();
    s.tick(mode === "expire" ? 901000 : 5000);
    await expect(s.login.check()).rejects.toThrow();
    expect(s.save).not.toHaveBeenCalled();
  }
});

it("prevents opening Edge with a stale or cancelled code", async () => {
  const s = setup([challenge]);
  await s.login.start();
  s.tick(901000);
  await expect(s.login.openBrowser()).rejects.toThrow();
  expect(s.open).not.toHaveBeenCalled();
});
