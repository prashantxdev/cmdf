import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  listFiles,
  createDirectory,
  createFile,
  readFile,
  movePath,
  renamePath,
  copyPath,
  deleteFile,
  searchFiles,
  searchContent,
} from "../src/actions/filesystem.js";

describe("Native Filesystem Actions", () => {
  let testWorkspace: string;

  beforeEach(() => {
    testWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "cmdf-test-"));
  });

  afterEach(() => {
    if (fs.existsSync(testWorkspace)) {
      fs.rmSync(testWorkspace, { recursive: true, force: true });
    }
  });

  it("creates single and nested directories", async () => {
    const res1 = await createDirectory(testWorkspace, "nested/deep/folder");
    expect(res1.success).toBe(true);
    expect(fs.existsSync(path.join(testWorkspace, "nested/deep/folder"))).toBe(
      true,
    );
  });

  it("creates and reads text files", async () => {
    const fileRes = await createFile(
      testWorkspace,
      "docs/hello.txt",
      "Hello cmdf world!\nLine 2",
    );
    expect(fileRes.success).toBe(true);

    const readRes = await readFile(testWorkspace, "docs/hello.txt");
    expect(readRes.success).toBe(true);
    expect(readRes.data).toContain("Hello cmdf world!");
  });

  it("prevents accidental file overwrite unless overwrite flag is true", async () => {
    await createFile(testWorkspace, "note.txt", "Original content");
    await expect(
      createFile(testWorkspace, "note.txt", "New content"),
    ).rejects.toThrow(/File already exists/);

    const overwriteRes = await createFile(
      testWorkspace,
      "note.txt",
      "New content",
      true,
    );
    expect(overwriteRes.success).toBe(true);
    const read = await readFile(testWorkspace, "note.txt");
    expect(read.data).toBe("New content");
  });

  it("lists directory contents with hidden filter", async () => {
    await createFile(testWorkspace, "file1.txt", "content1");
    await createFile(testWorkspace, ".hidden.txt", "secret");

    const visibleRes = await listFiles(testWorkspace, ".", false);
    const visibleNames = (visibleRes.data as Array<{ name: string }>).map(
      (e) => e.name,
    );
    expect(visibleNames).toContain("file1.txt");
    expect(visibleNames).not.toContain(".hidden.txt");

    const allRes = await listFiles(testWorkspace, ".", true);
    const allNames = (allRes.data as Array<{ name: string }>).map(
      (e) => e.name,
    );
    expect(allNames).toContain("file1.txt");
    expect(allNames).toContain(".hidden.txt");
  });

  it("renames and moves files", async () => {
    await createFile(testWorkspace, "old.txt", "rename me");
    const renameRes = await renamePath(testWorkspace, "old.txt", "new.txt");
    expect(renameRes.success).toBe(true);
    expect(fs.existsSync(path.join(testWorkspace, "old.txt"))).toBe(false);
    expect(fs.existsSync(path.join(testWorkspace, "new.txt"))).toBe(true);

    await createDirectory(testWorkspace, "archive");
    const moveRes = await movePath(testWorkspace, "new.txt", "archive/new.txt");
    expect(moveRes.success).toBe(true);
    expect(fs.existsSync(path.join(testWorkspace, "archive/new.txt"))).toBe(
      true,
    );
  });

  it("copies files and directories recursively", async () => {
    await createFile(testWorkspace, "src/app.ts", "console.log(1)");
    const copyRes = await copyPath(testWorkspace, "src", "src-backup");
    expect(copyRes.success).toBe(true);
    expect(fs.existsSync(path.join(testWorkspace, "src-backup/app.ts"))).toBe(
      true,
    );
  });

  it("deletes files safely and refuses directory deletion via deleteFile", async () => {
    await createFile(testWorkspace, "temp.txt", "delete me");
    const delRes = await deleteFile(testWorkspace, "temp.txt");
    expect(delRes.success).toBe(true);
    expect(fs.existsSync(path.join(testWorkspace, "temp.txt"))).toBe(false);

    await createDirectory(testWorkspace, "safe-dir");
    await expect(deleteFile(testWorkspace, "safe-dir")).rejects.toThrow(
      /is a directory/,
    );
  });

  it("searches files by pattern and content", async () => {
    await createFile(testWorkspace, "src/index.ts", "const a = 1;");
    await createFile(testWorkspace, "src/test.java", "// TODO: fix this bug");
    await createFile(testWorkspace, "docs/readme.md", "Project docs");

    const searchRes = await searchFiles(testWorkspace, ".", "*.java");
    expect(searchRes.data).toContain(path.normalize("src/test.java"));

    const contentRes = await searchContent(testWorkspace, ".", "TODO");
    expect(contentRes.message).toContain("1 occurrences");
  });

  it("protects .git and .env files from deletion or unauthorized access", async () => {
    await expect(deleteFile(testWorkspace, ".env")).rejects.toThrow(
      /protected/i,
    );
    await expect(deleteFile(testWorkspace, ".git")).rejects.toThrow(
      /protected/i,
    );
  });
});
