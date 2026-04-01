import { describe, expect, it, vi, afterEach } from "vitest";

vi.mock("../../config/config.js", () => ({
  loadConfig: vi.fn(() => ({})),
}));

import { loadConfig } from "../../config/config.js";
import {
  getConfiguredSharedLocalSourceAllowedPathPrefixes,
  getDefaultSharedLocalSourceAllowedPathPrefixes,
  resolveSharedDefaultToolPolicy,
} from "./shared-default-policy.js";

describe("shared default tool policy", () => {
  afterEach(() => {
    vi.mocked(loadConfig).mockReset();
    vi.mocked(loadConfig).mockReturnValue({} as never);
  });

  it("uses current hardcoded local-source prefixes as defaults", () => {
    expect(getDefaultSharedLocalSourceAllowedPathPrefixes()).toEqual([
      "./",
      ".\\",
      "tmp/",
      "tmp\\",
      "./tmp/",
      ".\\tmp\\",
    ]);
    expect(getConfiguredSharedLocalSourceAllowedPathPrefixes()).toEqual([
      "./",
      ".\\",
      "tmp/",
      "tmp\\",
      "./tmp/",
      ".\\tmp\\",
    ]);
  });

  it("denies nodes in shared baseline", () => {
    const decision = resolveSharedDefaultToolPolicy({
      toolName: "nodes",
      args: { action: "status" },
    });

    expect(decision).toMatchObject({
      allow: false,
      route: "deny",
      reason: "共享模式暂不支持 nodes 能力，请改用独立实例 (action: status)",
    });
  });

  it("denies image requests that raise maxBytesMb beyond shared lightweight boundary", () => {
    const decision = resolveSharedDefaultToolPolicy({
      toolName: "image",
      args: { maxBytesMb: 20 },
    });

    expect(decision).toMatchObject({
      allow: false,
      route: "deny",
      ruleId: "shared.image.max-bytes.deny.v1",
      reason: "共享模式仅支持轻量图片能力：maxBytesMb 不能超过 10",
    });
  });

  it("denies remote image sources in shared mode", () => {
    const decision = resolveSharedDefaultToolPolicy({
      toolName: "image",
      args: { image: "https://example.com/a.png" },
    });

    expect(decision).toMatchObject({
      allow: false,
      route: "deny",
      ruleId: "shared.image.remote-source.deny.v1",
      reason: "共享模式仅支持轻量图片能力：不支持远程 http(s) 图片来源",
    });
  });

  it("denies local image sources that escape the shared relative-path boundary", () => {
    const decision = resolveSharedDefaultToolPolicy({
      toolName: "image",
      args: { image: "../tmp/a.png" },
    });

    expect(decision).toMatchObject({
      allow: false,
      route: "deny",
      ruleId: "shared.image.local-path-boundary.deny.v1",
      reason: "共享模式仅支持轻量图片能力：本地图片来源必须是受限相对路径，不能越界",
    });
  });

  it("denies image requests that raise maxImages beyond shared lightweight boundary", () => {
    const decision = resolveSharedDefaultToolPolicy({
      toolName: "image",
      args: { maxImages: 8 },
    });

    expect(decision).toMatchObject({
      allow: false,
      route: "deny",
      ruleId: "shared.image.max-images.deny.v1",
      reason: "共享模式仅支持轻量图片能力：maxImages 不能超过 5",
    });
  });

  it("denies pdf requests that raise maxBytesMb beyond shared lightweight boundary", () => {
    const decision = resolveSharedDefaultToolPolicy({
      toolName: "pdf",
      args: { maxBytesMb: 20 },
    });

    expect(decision).toMatchObject({
      allow: false,
      route: "deny",
      ruleId: "shared.pdf.max-bytes.deny.v1",
      reason: "共享模式仅支持轻量 PDF 能力：maxBytesMb 不能超过 10",
    });
  });

  it("denies remote pdf sources in shared mode", () => {
    const decision = resolveSharedDefaultToolPolicy({
      toolName: "pdf",
      args: { pdf: "https://example.com/a.pdf" },
    });

    expect(decision).toMatchObject({
      allow: false,
      route: "deny",
      ruleId: "shared.pdf.remote-source.deny.v1",
      reason: "共享模式仅支持轻量 PDF 能力：不支持远程 http(s) PDF 来源",
    });
  });

  it("denies local pdf sources that escape the shared relative-path boundary", () => {
    const decision = resolveSharedDefaultToolPolicy({
      toolName: "pdf",
      args: { pdf: "../tmp/a.pdf" },
    });

    expect(decision).toMatchObject({
      allow: false,
      route: "deny",
      ruleId: "shared.pdf.local-path-boundary.deny.v1",
      reason: "共享模式仅支持轻量 PDF 能力：本地 PDF 来源必须是受限相对路径，不能越界",
    });
  });

  it("denies message media payloads when action is not in the lightweight allowlist", () => {
    const decision = resolveSharedDefaultToolPolicy({
      toolName: "message",
      args: { action: "delete", filePath: "./tmp/a.png" },
    });

    expect(decision).toMatchObject({
      allow: false,
      route: "deny",
      ruleId: "shared.message.media-action.deny.v1",
      reason: "共享模式仅支持轻量消息媒体能力：当前 action 不允许携带附件/媒体",
    });
  });

  it("denies remote message media in shared mode", () => {
    const decision = resolveSharedDefaultToolPolicy({
      toolName: "message",
      args: { action: "send", media: "https://example.com/a.png" },
    });

    expect(decision).toMatchObject({
      allow: false,
      route: "deny",
      ruleId: "shared.message.remote-media.deny.v1",
      reason: "共享模式仅支持轻量消息媒体能力：不支持远程 http(s) 媒体来源",
    });
  });

  it("denies attachment paths outside the lightweight shared area", () => {
    const decision = resolveSharedDefaultToolPolicy({
      toolName: "message",
      args: { action: "sendAttachment", filePath: "../tmp/a.png" },
    });

    expect(decision).toMatchObject({
      allow: false,
      route: "deny",
      ruleId: "shared.message.file-path.deny.v1",
      reason: "共享模式仅支持轻量消息媒体能力：附件路径必须是共享轻量目录下的相对小文件",
    });
  });

  it("denies unsupported message file types in shared mode", () => {
    const decision = resolveSharedDefaultToolPolicy({
      toolName: "message",
      args: { action: "sendAttachment", filePath: "./tmp/archive.zip" },
    });

    expect(decision).toMatchObject({
      allow: false,
      route: "deny",
      ruleId: "shared.message.file-type.deny.v1",
      reason: "共享模式仅支持轻量消息媒体能力：仅允许常见小文件类型",
    });
  });

  it("denies oversized message buffers in shared mode", () => {
    const tooLarge = "A".repeat(3 * 1024 * 1024);
    const decision = resolveSharedDefaultToolPolicy({
      toolName: "message",
      args: { action: "sendAttachment", buffer: tooLarge },
    });

    expect(decision).toMatchObject({
      allow: false,
      route: "deny",
      ruleId: "shared.message.buffer-too-large.deny.v1",
      reason: "共享模式仅支持轻量消息媒体能力：buffer 不能超过 2 MB",
    });
  });

  it("denies message data-url media in shared mode", () => {
    const decision = resolveSharedDefaultToolPolicy({
      toolName: "message",
      args: { action: "send", media: "data:image/png;base64,AAAA" },
    });

    expect(decision).toMatchObject({
      allow: false,
      route: "deny",
      ruleId: "shared.message.data-url.deny.v1",
      reason: "共享模式仅支持轻量消息媒体能力：请使用小文件路径或轻量 buffer，不要直接传 data URL",
    });
  });

  it("keeps default local policy for lightweight message file sends", () => {
    const decision = resolveSharedDefaultToolPolicy({
      toolName: "message",
      args: { action: "sendAttachment", filePath: "./tmp/a.png" },
    });

    expect(decision).toMatchObject({
      allow: true,
      route: "local",
      ruleId: "default.local.v1",
    });
  });

  it("keeps default local policy for normalized lightweight tmp paths", () => {
    const decision = resolveSharedDefaultToolPolicy({
      toolName: "message",
      args: { action: "sendAttachment", filePath: "tmp/a.png" },
    });

    expect(decision).toMatchObject({
      allow: true,
      route: "local",
      ruleId: "default.local.v1",
    });
  });

  it("uses configured shared whitelist override consistently for message/image/pdf local sources", () => {
    vi.mocked(loadConfig).mockReturnValue({
      tools: {
        shared: {
          localSourceValidation: {
            allowedPathPrefixes: ["media/shared/"],
          },
        },
      },
    } as never);

    expect(getConfiguredSharedLocalSourceAllowedPathPrefixes()).toEqual(["media/shared/"]);

    const messageAllowed = resolveSharedDefaultToolPolicy({
      toolName: "message",
      args: { action: "sendAttachment", filePath: "media/shared/a.png" },
    });
    expect(messageAllowed).toMatchObject({ allow: true, route: "local", ruleId: "default.local.v1" });

    const imageAllowed = resolveSharedDefaultToolPolicy({
      toolName: "image",
      args: { image: "media/shared/a.png" },
    });
    expect(imageAllowed).toMatchObject({ allow: true, route: "local", ruleId: "default.local.v1" });

    const pdfAllowed = resolveSharedDefaultToolPolicy({
      toolName: "pdf",
      args: { pdf: "media/shared/a.pdf" },
    });
    expect(pdfAllowed).toMatchObject({ allow: true, route: "local", ruleId: "default.local.v1" });

    const messageDenied = resolveSharedDefaultToolPolicy({
      toolName: "message",
      args: { action: "sendAttachment", filePath: "./tmp/a.png" },
    });
    expect(messageDenied).toMatchObject({
      allow: false,
      route: "deny",
      ruleId: "shared.message.file-path.deny.v1",
    });

    const imageDenied = resolveSharedDefaultToolPolicy({
      toolName: "image",
      args: { image: "tmp/a.png" },
    });
    expect(imageDenied).toMatchObject({
      allow: false,
      route: "deny",
      ruleId: "shared.image.local-path-boundary.deny.v1",
    });

    const pdfDenied = resolveSharedDefaultToolPolicy({
      toolName: "pdf",
      args: { pdf: "tmp/a.pdf" },
    });
    expect(pdfDenied).toMatchObject({
      allow: false,
      route: "deny",
      ruleId: "shared.pdf.local-path-boundary.deny.v1",
    });
  });
});
