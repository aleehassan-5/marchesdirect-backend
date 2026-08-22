import { validateUpload, UploadValidationError } from "../storageService";

function file(overrides: Partial<Express.Multer.File>): Express.Multer.File {
  return {
    mimetype: "application/pdf",
    size: 1024,
    originalname: "test.pdf",
    ...overrides,
  } as Express.Multer.File;
}

describe("validateUpload", () => {
  it("accepts an allowed mime type under the size limit", () => {
    expect(() => validateUpload(file({ mimetype: "application/pdf", size: 5 * 1024 * 1024 }))).not.toThrow();
  });

  it("rejects a disallowed mime type", () => {
    expect(() => validateUpload(file({ mimetype: "application/x-msdownload" }))).toThrow(UploadValidationError);
  });

  it("rejects a file over 15MB", () => {
    expect(() => validateUpload(file({ size: 16 * 1024 * 1024 }))).toThrow(UploadValidationError);
  });

  it("accepts a file exactly at the 15MB boundary", () => {
    expect(() => validateUpload(file({ size: 15 * 1024 * 1024 }))).not.toThrow();
  });

  it("accepts docx alongside pdf/jpeg/png/doc", () => {
    expect(() =>
      validateUpload(
        file({ mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" })
      )
    ).not.toThrow();
  });
});
