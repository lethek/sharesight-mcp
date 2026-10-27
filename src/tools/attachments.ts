import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { z } from "zod";

/** Inputs for the tools that create or update a trade or payout, which Sharesight lets carry one attachment. */
export const attachmentInput = {
  attachment_base64: z.string().min(1).optional().describe("File to attach, base64 encoded. Needs attachment_filename. Use attachment_path instead for a large file."),
  attachment_path: z.string().min(1).optional().describe("Path of a file on the machine running the server, to attach. Only works when the server runs over stdio, not HTTP."),
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

/**
 * Turns the attachment inputs into the fields Sharesight takes (`attachment` as base64, and `attachment_filename`) and returns the
 * rest of the arguments unchanged. Removal sends both as null, which is how the Sharesight docs say to remove an attachment.
 *
 * @param allowFilePaths - false when the server is reachable over HTTP, where reading a path on the server's machine for a remote
 *   caller is not safe
 */
export async function withAttachment<T extends AttachmentArgs>(args: T, allowFilePaths: boolean): Promise<WithAttachment<T>> {
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
    if (!allowFilePaths) {
      throw new Error("attachment_path is only available when the server runs over stdio. Send the file as attachment_base64 instead.");
    }

    const content = await readFile(path);

    return { ...rest, attachment: content.toString("base64"), attachment_filename: filename ?? basename(path) } as WithAttachment<T>;
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
