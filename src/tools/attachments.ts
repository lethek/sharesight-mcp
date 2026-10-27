import { readFile, realpath } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve } from "node:path";
import { z } from "zod";

/** Inputs for the tools that create or update a trade or payout, which Sharesight lets carry one attachment. */
export const attachmentInput = {
  attachment_base64: z.string().min(1).optional().describe("File to attach, base64 encoded. Needs attachment_filename. Use attachment_path instead for a large file."),
  attachment_path: z.string().min(1).optional().describe("Path of a file on the machine running the server, to attach. If the server has a data root, the path is relative to it and must be inside it. Over HTTP it only works when the server has a data root."),
  attachment_filename: z.string().min(1).optional().describe("File name for the attachment, with its extension. Required with attachment_base64; defaults to the file's own name with attachment_path."),
};

/** Added to the update tools, where an attachment can already exist. */
export const attachmentRemoval = {
  remove_attachment: z.boolean().optional().describe("true to remove the existing attachment"),
};

interface AttachmentArgs {
  attachment_base64?: string;
  attachment_path?: string;
  attachment_filename?: string;
  remove_attachment?: boolean;
}

type AttachmentKeys = keyof AttachmentArgs;

export type WithAttachment<T> = Omit<T, AttachmentKeys> & { attachment?: string | null; attachment_filename?: string | null };

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** Where attachment_path may read from. */
export interface PathPolicy {
  /** Absolute path of the data root. When set, paths are relative to it and must stay inside it. */
  root?: string;
  /** With no root, whether any path on the machine may be read. True only for a local stdio server. */
  unrestricted: boolean;
}

/**
 * Returns the real path of the file to read. With a data root, the path is taken relative to the root (an absolute path must
 * already be inside it) and symbolic links are followed before the check, so a link cannot lead out of the root.
 */
async function resolveAttachmentPath(path: string, { root, unrestricted }: PathPolicy): Promise<string> {
  if (root === undefined) {
    if (!unrestricted) {
      throw new Error("attachment_path is not available because the server has no MCP_DATA_ROOT. Send the file as attachment_base64 instead.");
    }

    return path;
  }

  const [realRoot, realFile] = await Promise.all([realpath(root), realpath(resolve(root, path))]);
  const fromRoot = relative(realRoot, realFile);

  if (fromRoot === "" || fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
    throw new Error("attachment_path must be a file inside the server's data root.");
  }

  return realFile;
}

/**
 * Turns the attachment inputs into the fields Sharesight takes (`attachment` as base64, and `attachment_filename`) and returns the
 * rest of the arguments unchanged. Removal sends both as null, which is how the Sharesight docs say to remove an attachment.
 *
 * @param paths - where attachment_path may read from
 */
export async function withAttachment<T extends AttachmentArgs>(args: T, paths: PathPolicy): Promise<WithAttachment<T>> {
  const { attachment_base64: base64, attachment_path: path, attachment_filename: filename, remove_attachment: remove, ...rest } = args;

  if (remove) {
    if (base64 !== undefined || path !== undefined || filename !== undefined) {
      throw new Error("remove_attachment cannot be combined with a new attachment.");
    }

    return { ...rest, attachment: null, attachment_filename: null } as WithAttachment<T>;
  }

  if (base64 !== undefined && path !== undefined) {
    throw new Error("Give attachment_base64 or attachment_path, not both.");
  }

  if (path !== undefined) {
    const file = await resolveAttachmentPath(path, paths);
    const content = await readFile(file);

    return { ...rest, attachment: content.toString("base64"), attachment_filename: filename ?? basename(file) } as WithAttachment<T>;
  }

  if (base64 !== undefined) {
    if (filename === undefined) {
      throw new Error("attachment_filename is required with attachment_base64.");
    }

    if (!BASE64.test(base64)) {
      throw new Error("attachment_base64 is not valid base64 (no line breaks, no data: prefix).");
    }

    return { ...rest, attachment: base64, attachment_filename: filename } as WithAttachment<T>;
  }

  if (filename !== undefined) {
    throw new Error("attachment_filename needs attachment_base64 or attachment_path.");
  }

  return rest as WithAttachment<T>;
}
