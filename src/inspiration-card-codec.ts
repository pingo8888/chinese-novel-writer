export interface ParsedCardContent {
  frontmatterBody: string | null;
  cwDataBody: string | null;
  body: string;
  tagsLine: string;
  images: string[];
  color: string | null;
  isPinned: boolean;
  isFloating: boolean;
  floatingX: number | null;
  floatingY: number | null;
  floatingWidth: number | null;
  floatingHeight: number | null;
}

export class InspirationCardCodec {
  parseCardContent(content: string): ParsedCardContent {
    const normalized = content.replace(/\r\n?/g, "\n");
    const frontmatterInfo = this.getFrontmatterInfo(normalized);
    const frontmatterBody = frontmatterInfo?.body ?? null;
    const afterFrontmatter = frontmatterInfo ? normalized.slice(frontmatterInfo.endIndex) : normalized;

    const cwDataInfo = this.getCwDataInfo(afterFrontmatter);
    const bodyWithTags = cwDataInfo
      ? `${afterFrontmatter.slice(0, cwDataInfo.startIndex)}${afterFrontmatter.slice(cwDataInfo.endIndex)}`
      : afterFrontmatter;
    const cwDataObj = this.parseCwDataObject(cwDataInfo?.body ?? null);
    const cwTagsLine = this.formatTagLineFromTokens(this.extractTagTokens(cwDataObj?.tags));
    const images = this.extractImagePaths(cwDataObj?.images);
    const color = this.normalizeHexColor(cwDataObj?.color);
    const isPinned = cwDataObj?.ispinned === true;
    const isFloating = cwDataObj?.isfloating === true;
    const floatingX = this.normalizeFiniteNumber(cwDataObj?.floatx);
    const floatingY = this.normalizeFiniteNumber(cwDataObj?.floaty);
    const floatingWidth = this.normalizeFiniteNumber(cwDataObj?.floatw);
    const floatingHeight = this.normalizeFiniteNumber(cwDataObj?.floath);

    return {
      frontmatterBody,
      cwDataBody: cwDataInfo?.body ?? null,
      body: bodyWithTags.replace(/^\n+/, ""),
      tagsLine: cwTagsLine,
      images,
      color,
      isPinned,
      isFloating,
      floatingX,
      floatingY,
      floatingWidth,
      floatingHeight,
    };
  }

  composeContent(frontmatterBody: string | null, cwDataBody: string | null, body: string): string {
    const chunks: string[] = [];
    if (frontmatterBody && frontmatterBody.trim().length > 0) {
      chunks.push(`---\n${frontmatterBody.replace(/\n+$/g, "")}\n---`);
    }
    if (cwDataBody && cwDataBody.trim().length > 0) {
      chunks.push(`<!---cw-data\n${cwDataBody.replace(/\n+$/g, "")}\n--->`);
    }
    chunks.push(body.replace(/^\n+/, "").replace(/\n+$/g, ""));
    return chunks.join("\n\n");
  }

  normalizeTagLine(value: string): string {
    return this.formatTagLineFromTokens(this.extractTagTokens(value));
  }

  extractTagTokens(value: unknown): string[] {
    const rawItems: string[] = [];
    if (typeof value === "string") {
      rawItems.push(value);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string") {
          rawItems.push(item);
        }
      }
    }

    const tokens: string[] = [];
    const seen = new Set<string>();

    for (const raw of rawItems) {
      const directMatches = raw.match(/#[^\s,#]+/g);
      if (directMatches && directMatches.length > 0) {
        for (const match of directMatches) {
          const core = match.slice(1).trim();
          if (!core) continue;
          const normalized = `#${core}`;
          if (seen.has(normalized)) continue;
          seen.add(normalized);
          tokens.push(normalized);
        }
        continue;
      }

      const segments = raw
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
      for (const segment of segments) {
        const core = segment.startsWith("#") ? segment.slice(1).trim() : segment.trim();
        if (!core || /\s/.test(core)) continue;
        const normalized = `#${core}`;
        if (seen.has(normalized)) continue;
        seen.add(normalized);
        tokens.push(normalized);
      }
    }

    return tokens;
  }

  formatTagLineFromTokens(tokens: string[]): string {
    return tokens.length > 0 ? ` ${tokens.join(" ")}` : "";
  }

  formatTagCsvFromTokens(tokens: string[]): string | null {
    return tokens.length > 0 ? tokens.join(",") : null;
  }

  extractImagePaths(value: unknown): string[] {
    const rawItems: string[] = [];
    if (typeof value === "string") {
      rawItems.push(value);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string") {
          rawItems.push(item);
        }
      }
    }
    const paths = rawItems
      .flatMap((item) => item.split(","))
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    return this.normalizeImagePaths(paths);
  }

  formatImageCsv(paths: string[]): string | null {
    const normalized = this.normalizeImagePaths(paths);
    return normalized.length > 0 ? normalized.join(",") : null;
  }

  parseCwDataObject(cwDataBody: string | null): Record<string, any> | null {
    const normalized = (cwDataBody ?? "").trim();
    if (!normalized) return null;
    const safe = normalized.replace(/("color"\s*:\s*)(#[0-9a-fA-F]{6})/g, '$1"$2"');
    try {
      const parsed = JSON.parse(safe);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }

  normalizeHexColor(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed.toUpperCase() : null;
  }

  normalizeFiniteNumber(value: unknown): number | null {
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    return value;
  }

  private normalizeImagePaths(paths: string[]): string[] {
    const seen = new Set<string>();
    const normalized: string[] = [];
    for (const rawPath of paths) {
      const path = rawPath.trim();
      if (!path || seen.has(path)) continue;
      seen.add(path);
      normalized.push(path);
      if (normalized.length >= 8) break;
    }
    return normalized;
  }

  private getFrontmatterInfo(content: string): { body: string; endIndex: number } | null {
    if (!content.startsWith("---\n")) return null;
    const endIndex = content.indexOf("\n---\n", 4);
    if (endIndex === -1) return null;
    const body = content.slice(4, endIndex);
    return { body, endIndex: endIndex + 5 };
  }

  private getCwDataInfo(content: string): { body: string; startIndex: number; endIndex: number } | null {
    const regex = /<!---cw-data\s*\n([\s\S]*?)\n--->/m;
    const match = regex.exec(content);
    if (!match || match.index < 0) return null;
    return {
      body: match[1] ?? "",
      startIndex: match.index,
      endIndex: match.index + match[0].length,
    };
  }
}
