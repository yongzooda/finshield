// ============================================================
// 격리 Parser worker 의 preload. network API 호출을 막고 시도 횟수를 센다.
// 실제 격리는 network namespace(unshare -n)와 Node permission model 이 담당하고,
// 이 guard 는 그 안에서 Parser 코드가 network 를 시도했는지 관측하는 계수기다.
// node --import ./file-safety-guard.mjs 로만 쓴다.
// ============================================================
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";

const state = { attempts: 0, kinds: [], raw: { netConnect: net.Socket.prototype.connect, lookup: dns.lookup, fetch: globalThis.fetch } };
const block = (kind) => {
  state.attempts += 1;
  if (state.kinds.length < 20) state.kinds.push(kind);
  const error = new Error(`network blocked by file-safety guard: ${kind}`);
  error.code = "FINSHIELD_NETWORK_BLOCKED";
  throw error;
};
net.Socket.prototype.connect = function blockedConnect() { block("net.connect"); };
net.createConnection = () => block("net.createConnection");
net.connect = () => block("net.connect");
tls.connect = () => block("tls.connect");
http.request = () => block("http.request");
http.get = () => block("http.get");
https.request = () => block("https.request");
https.get = () => block("https.get");
dns.lookup = (...args) => { const cb = args[args.length - 1]; try { block("dns.lookup"); } catch (e) { if (typeof cb === "function") { cb(e); return; } throw e; } };
dns.promises.lookup = async () => block("dns.promises.lookup");
dns.resolve = (...args) => { const cb = args[args.length - 1]; try { block("dns.resolve"); } catch (e) { if (typeof cb === "function") { cb(e); return; } throw e; } };
globalThis.fetch = async () => block("fetch");
if (typeof globalThis.WebSocket !== "undefined") globalThis.WebSocket = function BlockedWebSocket() { block("WebSocket"); };
Object.defineProperty(globalThis, "__finshieldNetworkGuard", { value: state, enumerable: false, writable: false });
