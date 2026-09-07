import { afterEach, expect, it, vi } from "vitest";
import { readQuarantinedFile } from "../files/storage";
import { storageServiceHeaders } from "../files/service-headers";

const config = vi.hoisted(() => ({
  FINSHIELD_DATABASE_URL: "postgres://unused",
  SUPABASE_URL: "https://storage.example.org",
  SUPABASE_SECRET_KEY: "sb_secret_synthetic",
}));
vi.mock("../env", () => ({ finshieldEnv: () => config }));
afterEach(() => vi.unstubAllGlobals());

it("새 secret으로 격리 파일을 읽을 때 JWT Authorization을 만들지 않는다", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3])));
  vi.stubGlobal("fetch", fetch);
  expect(await readQuarantinedFile("owner/input/file.pdf", 3)).toEqual(Buffer.from([1, 2, 3]));
  expect(fetch).toHaveBeenCalledWith(
    "https://storage.example.org/storage/v1/object/finshield-quarantine/owner/input/file.pdf",
    expect.objectContaining({ headers: { apikey: "sb_secret_synthetic" }, redirect: "error" }),
  );
});

it("기존 service_role JWT의 인증 헤더는 보존하고 공개 키는 거부한다", () => {
  expect(storageServiceHeaders("header.payload.signature")).toEqual({
    apikey: "header.payload.signature", Authorization: "Bearer header.payload.signature",
  });
  expect(() => storageServiceHeaders("sb_publishable_synthetic")).toThrow("STORAGE_SERVICE_KEY_REQUIRED");
});

it("Storage가 슬롯 크기보다 큰 파일을 반환하면 저장·파싱 전에 거부한다", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]))));
  await expect(readQuarantinedFile("owner/input/file.pdf", 2)).rejects.toThrow("FILE_SIZE_MISMATCH");
});
