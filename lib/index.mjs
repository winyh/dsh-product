import Schema from "@deepseek-ai/schemastery";
import * as webFetchHttp from "@deepseek-ai/dsh-web-fetch-http";
import { defineTool } from "@deepseek-ai/dsh-tools";

//#region src/data.ts
function parseCsvLine(line) {
	const cells = [];
	let current = "";
	let quoted = false;
	for (let index = 0; index < line.length; index += 1) {
		const char = line[index];
		if (char === "\"") if (quoted && line[index + 1] === "\"") {
			current += "\"";
			index += 1;
		} else quoted = !quoted;
		else if (char === "," && !quoted) {
			cells.push(current.trim());
			current = "";
		} else current += char;
	}
	cells.push(current.trim());
	return cells;
}
function normalizeCell(value) {
	if (value === void 0 || value === null) return value;
	if (typeof value !== "string") return value;
	const trimmed = value.trim();
	if (!trimmed) return "";
	if (trimmed === "true") return true;
	if (trimmed === "false") return false;
	if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
	return trimmed;
}
function parseCsv(content) {
	const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim().length > 0);
	if (lines.length === 0) return [];
	const headers = parseCsvLine(lines[0] ?? "").map((header) => header.trim());
	return lines.slice(1).map((line) => {
		const cells = parseCsvLine(line);
		return Object.fromEntries(headers.map((header, index) => [header, normalizeCell(cells[index])]));
	});
}
function parseJson(content) {
	const parsed = JSON.parse(content);
	if (Array.isArray(parsed)) return parsed.filter((item) => typeof item === "object" && item !== null && !Array.isArray(item));
	if (typeof parsed === "object" && parsed !== null) return [parsed];
	throw new Error("JSON dataset must be an object or an array of objects");
}
function parseJsonLines(content) {
	return content.split(/\r?\n/).flatMap((line, index) => {
		if (!line.trim()) return [];
		const parsed = JSON.parse(line);
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error(`JSONL line ${index + 1} is not an object`);
		return [parsed];
	});
}
function parseDataset(path, content, maxRows) {
	const lower = path.toLowerCase();
	const warnings = [];
	let rows;
	if (lower.endsWith(".csv")) rows = parseCsv(content);
	else if (lower.endsWith(".jsonl") || lower.endsWith(".ndjson")) rows = parseJsonLines(content);
	else if (lower.endsWith(".json")) rows = parseJson(content);
	else throw new Error(`Unsupported dataset format: ${path}`);
	if (rows.length > maxRows) {
		warnings.push(`Rows truncated from ${rows.length} to configured maxRows ${maxRows}`);
		rows = rows.slice(0, maxRows);
	}
	if (rows.length === 0) warnings.push("Dataset contains no rows");
	return {
		rows,
		warnings
	};
}
async function readDataset(fs, config, path, signal) {
	const target = await fs.resolve(path, { signal });
	const info = await fs.stat(target, signal);
	if (!info || info.type !== "file") throw new Error(`Dataset not found: ${path}`);
	if ((info.size ?? 0) > config.maxFileBytes) throw new Error(`Dataset exceeds maxFileBytes (${config.maxFileBytes})`);
	const content = await fs.readText(target, signal);
	if (content.length > config.maxTextChars) throw new Error(`Dataset exceeds maxTextChars (${config.maxTextChars})`);
	return {
		source: path,
		...parseDataset(path, content, config.maxRows)
	};
}
function stringValue(row, key) {
	if (!key) return void 0;
	const value = row[key];
	if (value === void 0 || value === null || value === "") return void 0;
	return String(value);
}
function numberValue(row, key) {
	if (!key) return void 0;
	const value = row[key];
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
}

//#endregion
//#region src/markdown.ts
function scalar(value) {
	const trimmed = value.trim();
	if (!trimmed) return "";
	if (trimmed.startsWith("\"") && trimmed.endsWith("\"") || trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1);
	if (trimmed === "true") return true;
	if (trimmed === "false") return false;
	if (trimmed === "null") return null;
	if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
	if (trimmed.startsWith("[") && trimmed.endsWith("]")) try {
		return JSON.parse(trimmed);
	} catch {
		return trimmed;
	}
	return trimmed;
}
function parseFrontmatter(content) {
	const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/);
	if (lines[0]?.trim() !== "---") return {
		frontmatter: {},
		body: content
	};
	const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
	if (end < 0) return {
		frontmatter: {},
		body: content
	};
	const frontmatter = {};
	let activeArrayKey = null;
	for (const line of lines.slice(1, end)) {
		const item = line.match(/^\s*-\s+(.+)$/);
		if (item && activeArrayKey) {
			const current = frontmatter[activeArrayKey];
			if (Array.isArray(current)) current.push(scalar(item[1] ?? ""));
			continue;
		}
		const match = line.match(/^\s*([^:#]+):\s*(.*)$/);
		if (!match) continue;
		const key = (match[1] ?? "").trim();
		const value = (match[2] ?? "").trim();
		if (!value) {
			frontmatter[key] = [];
			activeArrayKey = key;
		} else {
			frontmatter[key] = scalar(value);
			activeArrayKey = null;
		}
	}
	return {
		frontmatter,
		body: lines.slice(end + 1).join("\n")
	};
}
function splitTableLine(line) {
	return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}
function parseTables(body) {
	const lines = body.split(/\r?\n/);
	const tables = [];
	for (let index = 0; index < lines.length - 1; index += 1) {
		if (!lines[index]?.includes("|") || !lines[index + 1]?.includes("|")) continue;
		const headers = splitTableLine(lines[index] ?? "");
		const separator = splitTableLine(lines[index + 1] ?? "");
		if (headers.length === 0 || separator.length !== headers.length || !separator.every((cell) => /^:?-{3,}:?$/.test(cell))) continue;
		const rows = [];
		let rowIndex = index + 2;
		while (rowIndex < lines.length && lines[rowIndex]?.includes("|")) {
			const values = splitTableLine(lines[rowIndex] ?? "");
			if (values.length !== headers.length) break;
			rows.push(Object.fromEntries(headers.map((header, cellIndex) => [header, values[cellIndex] ?? ""])));
			rowIndex += 1;
		}
		tables.push({
			headers,
			rows
		});
		index = rowIndex - 1;
	}
	return tables;
}
function titleFrom(body, path, frontmatter) {
	if (typeof frontmatter.title === "string" && frontmatter.title.trim()) return frontmatter.title.trim();
	const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
	if (heading) return heading;
	return (path.split(/[\\/]/).pop() ?? path).replace(/\.[^.]+$/, "");
}
function artifactTypeFrom(frontmatter, content) {
	const explicit = String(frontmatter.type ?? "").toLowerCase();
	for (const [type, pattern] of [
		["product-context", /product[- ]context|产品上下文/i],
		["product-brief", /product[- ]brief|产品 brief|产品简报/i],
		["poc-plan", /poc|概念验证|可行性验证/i],
		["mvp-plan", /mvp|最小可行产品/i],
		["prd", /prd|product requirements|产品需求文档/i],
		["beta-plan", /beta|试点|内测/i],
		["pmf-review", /pmf|product[- ]market fit|产品市场匹配/i],
		["release-review", /release|上线|发布检查/i],
		["decision-review", /decision[- ]review|decision gate|continue[- ]or[- ]kill|产品决策门|决策门/i],
		["growth-handoff", /growth handoff|增长交接/i]
	]) if (explicit === type || pattern.test(explicit) || pattern.test(content)) return type;
}
function parseNote(path, content) {
	const { frontmatter, body } = parseFrontmatter(content);
	const headings = Array.from(body.matchAll(/^#{1,6}\s+(.+)$/gm)).map((match) => match[1]?.trim() ?? "").filter(Boolean);
	const internalLinks = Array.from(body.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)).map((match) => match[1]?.trim() ?? "").filter(Boolean);
	const externalLinks = [...new Set(Array.from(content.matchAll(/https?:\/\/[^\s)\]>]+/g)).map((match) => match[0]?.replace(/[.,;!?]+$/, "") ?? "").filter(Boolean))];
	return {
		path,
		title: titleFrom(body, path, frontmatter),
		content,
		frontmatter,
		headings,
		tables: parseTables(body),
		internalLinks,
		externalLinks,
		wordCount: body.trim() ? body.trim().split(/\s+/u).length : 0,
		artifactType: artifactTypeFrom(frontmatter, `${String(frontmatter.type ?? "")}\n${body}`)
	};
}
function listValue(value) {
	if (!value?.trim()) return [];
	const trimmed = value.trim();
	if (trimmed.startsWith("[")) {
		const parsed = JSON.parse(trimmed);
		if (!Array.isArray(parsed)) throw new Error("Expected a JSON array or newline-separated list.");
		return parsed.map((item) => String(item).trim()).filter(Boolean);
	}
	return trimmed.split(/\r?\n|\s*;\s*|\s*\|\s*/).map((item) => item.replace(/^[-*]\s+/, "").trim()).filter(Boolean);
}
function markdownList(items) {
	return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- 暂无";
}
function replacementDiff(before, after) {
	const beforeLines = before.split(/\r?\n/);
	const afterLines = after.split(/\r?\n/);
	const preview = [];
	let changedLines = 0;
	const length = Math.max(beforeLines.length, afterLines.length);
	for (let index = 0; index < length; index += 1) {
		const left = beforeLines[index];
		const right = afterLines[index];
		if (left === right) continue;
		changedLines += 1;
		if (preview.length < 20) {
			if (left !== void 0) preview.push(`- ${left}`);
			if (right !== void 0) preview.push(`+ ${right}`);
		}
	}
	return {
		beforeLines: beforeLines.length,
		afterLines: afterLines.length,
		changedLines,
		preview
	};
}

//#endregion
//#region src/onboarding.ts
const stages = [
	{
		id: "handoff",
		label: "机会交接",
		type: "product-context",
		objective: "把已确认机会转成产品上下文。",
		gate: "目标、结果、价值主张和来源可追溯。",
		tool: "product_brief",
		prompt: "把已确认的机会整理为产品 Brief；不要重新做需求发现。",
		action: "补齐产品目标、目标用户、期望结果和价值主张。"
	},
	{
		id: "strategy",
		label: "产品策略",
		type: "product-brief",
		objective: "明确产品要交付的核心结果和边界。",
		gate: "成功标准、约束和非目标明确。",
		tool: "product_brief",
		prompt: "审阅产品 Brief，检查目标、价值、成功标准和非目标。",
		action: "补齐成功标准和非目标，避免直接进入功能堆叠。"
	},
	{
		id: "poc",
		label: "POC",
		type: "poc-plan",
		objective: "先验证最高风险，而不是先做完整产品。",
		gate: "关键风险有测试方法、成功阈值和失败阈值。",
		tool: "product_poc_plan",
		prompt: "为最高影响 × 可能性风险生成 POC 计划。",
		action: "列出技术、工作流、价值和合规风险，并选择最小验证。"
	},
	{
		id: "mvp",
		label: "MVP",
		type: "mvp-plan",
		objective: "定义最小可交付、可观测的产品范围。",
		gate: "范围、非目标、流程、验收标准和成功指标齐全。",
		tool: "product_mvp_plan",
		prompt: "将通过 POC 的方向转成 MVP 范围和验收标准。",
		action: "补齐 MVP in-scope、out-of-scope、验收标准和埋点。"
	},
	{
		id: "beta",
		label: "Beta/发布",
		type: "release-review",
		objective: "以受控人群发布并观察真实使用。",
		gate: "发布检查项有证据、负责人和回滚/反馈机制。",
		tool: "product_release_check",
		prompt: "运行 Beta/发布检查，区分阻塞项和带条件项。",
		action: "补齐发布检查、观测窗口、反馈入口和回滚条件。"
	},
	{
		id: "pmf",
		label: "PMF",
		type: "pmf-review",
		objective: "判断价值、使用、留存、商业和推荐证据是否收敛。",
		gate: "至少形成价值信号与留存/商业信号的交叉证据。",
		tool: "product_pmf_review",
		prompt: "按分群复盘 PMF 证据，不输出单一分数。",
		action: "补充价值感知、使用、留存、付费/续费或推荐数据。"
	},
	{
		id: "iteration",
		label: "版本迭代",
		type: "mvp-plan",
		objective: "把 PMF 缺口转成下一轮产品假设和版本决策。",
		gate: "问题、证据、迭代目标和决策日期明确。",
		tool: "product_review",
		prompt: "根据当前证据生成下一轮迭代决策。",
		action: "把最高价值缺口转成一个有验收标准的版本目标。"
	},
	{
		id: "growth-handoff",
		label: "增长交接",
		type: "growth-handoff",
		objective: "把产品结果和测量口径交给增长运营。",
		gate: "产品结果、主指标、护栏指标和未决问题齐全。",
		tool: "product_growth_handoff",
		prompt: "生成产品到增长的交接包，交给 dsh-growth。",
		action: "补齐主指标、护栏指标、证据来源和未决问题。"
	}
];
function statusFor(count, hasArtifact, hasHealthy) {
	if (hasArtifact && hasHealthy) return "ready";
	if (count > 0 || hasArtifact) return "partial";
	return "missing";
}
function buildProductOnboarding(options) {
	const { root, scan } = options;
	const dimensions = stages.map((stage) => {
		const acceptedTypes = stage.id === "handoff" ? ["product-context", "product-brief"] : [stage.type];
		const notes = scan.productNotes.filter((note) => acceptedTypes.includes(note.artifactType));
		const count = notes.length;
		const healthy = notes.some((note) => note.reasons.length === 1 && note.reasons[0] === "healthy");
		const status = statusFor(count, count > 0, healthy);
		const evidence = notes.slice(0, 3).map((note) => `${note.path}（${note.status}）`);
		const missing = status === "ready" ? [] : [stage.gate];
		return {
			id: stage.id,
			label: stage.label,
			status,
			score: status === "ready" ? 100 : status === "partial" ? 50 : 0,
			evidence,
			missing,
			nextAction: status === "ready" ? `复核 ${stage.label} 的证据是否仍然有效。` : stage.action
		};
	});
	const current = dimensions.find((dimension) => dimension.status !== "ready")?.id ?? "growth-handoff";
	const sop = stages.map((stage, index) => {
		const dimension = dimensions[index];
		return {
			id: stage.id,
			order: index + 1,
			status: dimension?.status ?? "missing",
			objective: stage.objective,
			gate: stage.gate,
			tool: stage.tool,
			prompt: stage.prompt
		};
	});
	const readyCount = dimensions.filter((dimension) => dimension.status === "ready").length;
	const overallScore = Math.round(dimensions.reduce((sum, dimension) => sum + (dimension.score ?? 0), 0) / dimensions.length);
	const overallStatus = readyCount === dimensions.length ? "ready" : readyCount > 0 ? "partial" : "blocked";
	const topActions = dimensions.filter((dimension) => dimension.status !== "ready").slice(0, 2).map((dimension) => dimension.nextAction);
	const questions = dimensions.filter((dimension) => dimension.status !== "ready").slice(0, 3).map((dimension) => `${dimension.label}：${dimension.missing[0] ?? "证据是否存在？"}`);
	const warnings = [...scan.errors];
	if (scan.dataFiles.length === 0) warnings.push("没有发现可能用于 PMF/使用/留存复盘的本地数据文件；可以先完成方法论文档，再补数据。");
	return {
		generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
		root,
		overallStatus,
		overallScore,
		sources: {
			productNotes: scan.productNotes.length,
			dataFiles: scan.dataFiles,
			byType: scan.byType,
			byStatus: scan.byStatus
		},
		dimensions,
		sop: {
			currentStep: current,
			steps: sop
		},
		topActions,
		questions,
		warnings
	};
}

//#endregion
//#region src/feedback.ts
function text(value) {
	return value === void 0 || value === null ? "" : String(value).trim();
}
function redact(value) {
	return value.replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[redacted-email]").replace(/(?:\+?\d[\d\s().-]{7,}\d)/g, "[redacted-phone]").replace(/(?:姓名|name)\s*[:：]\s*[^,，;；\n]+/gi, "$1: [redacted-name]");
}
function themesFor(value) {
	const themes = [];
	if (/慢|耗时|time|slow|效率/i.test(value)) themes.push("效率");
	if (/错误|失败|bug|error|crash/i.test(value)) themes.push("可靠性");
	if (/难懂|复杂|confus|learn/i.test(value)) themes.push("易用性");
	if (/价格|付费|贵|price|pay/i.test(value)) themes.push("商业");
	return themes.length > 0 ? themes : ["其他"];
}
function buildBetaFeedbackImport(input) {
	const warnings = [];
	const records = input.feedback.flatMap((item, index) => {
		if (typeof item !== "object" || item === null) return [];
		const record = item;
		const raw = text(record.text ?? record.feedback ?? record.comment ?? record.content);
		if (!raw) return [];
		const redactedText = redact(raw);
		return [{
			id: text(record.id) || `feedback-${index + 1}`,
			...text(record.segment) ? { segment: text(record.segment) } : {},
			text: redactedText,
			themes: themesFor(redactedText)
		}];
	});
	if (records.length < input.feedback.length) warnings.push("部分反馈缺少可分析文本，已跳过。");
	const themeMap = /* @__PURE__ */ new Map();
	for (const record of records) for (const theme of record.themes) {
		const current = themeMap.get(theme) ?? {
			count: 0,
			examples: []
		};
		current.count += 1;
		if (current.examples.length < 3) current.examples.push(record.text);
		themeMap.set(theme, current);
	}
	const themes = [...themeMap.entries()].map(([theme, value]) => ({
		theme,
		...value
	})).sort((a, b) => b.count - a.count);
	const nextActions = records.length > 0 ? ["按主题抽样核验去标识化结果，再将高频问题带入 product_decision_review。"] : ["补充带文本的 Beta 反馈，再进行主题归纳。"];
	const generatedAt = (/* @__PURE__ */ new Date()).toISOString();
	const markdown = [
		"---",
		"artifactType: beta-feedback-import",
		`generatedAt: ${generatedAt}`,
		...input.source ? [`source: ${JSON.stringify(input.source)}`] : [],
		"---",
		"# Beta 反馈导入",
		"",
		`- 原始行数：${input.feedback.length}`,
		`- 接受行数：${records.length}`,
		"- 已去标识化：是",
		"",
		"## 主题",
		...themes.map((item) => `- ${item.theme}：${item.count}`),
		"",
		"## 下一步",
		...nextActions.map((item) => `- ${item}`),
		""
	].join("\n");
	return {
		artifactType: "beta-feedback-import",
		generatedAt,
		...input.source ? { source: input.source } : {},
		rowsRead: input.feedback.length,
		rowsAccepted: records.length,
		records,
		themes,
		redacted: true,
		warnings,
		nextActions,
		markdown
	};
}
function idFor(productName, stage, generatedAt) {
	return `${productName.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "product"}-${stage}-${generatedAt.slice(0, 10)}`;
}
function buildProductDecisionLog(input) {
	const generatedAt = (/* @__PURE__ */ new Date()).toISOString();
	const warnings = input.evidence.length === 0 ? ["没有提供决策证据；日志不能替代产品决策门。"] : [];
	const nextActions = input.nextReviewDate ? [`在 ${input.nextReviewDate} 重新检查证据和决策。`] : ["补充下一次复盘日期和负责人。"];
	const artifactId = idFor(input.productName, input.stage, generatedAt);
	const markdown = [
		"---",
		"schemaVersion: \"1.0\"",
		"artifactType: product-decision-log",
		`artifactId: ${artifactId}`,
		`generatedAt: ${generatedAt}`,
		`productName: ${JSON.stringify(input.productName)}`,
		`stage: ${input.stage}`,
		`decision: ${input.decision}`,
		...input.owner ? [`owner: ${JSON.stringify(input.owner)}`] : [],
		...input.source ? [`source: ${JSON.stringify(input.source)}`] : [],
		"---",
		`# ${input.productName} 产品决策日志`,
		"",
		`- 阶段：${input.stage}`,
		`- 决策：${input.decision}`,
		`- 理由：${input.rationale || "待补充"}`,
		"",
		"## 证据",
		...input.evidence.length > 0 ? input.evidence.map((item) => `- ${item}`) : ["- 缺失"],
		"",
		"## 下一步",
		...nextActions.map((item) => `- ${item}`),
		""
	].join("\n");
	return {
		artifactType: "product-decision-log",
		schemaVersion: "1.0",
		artifactId,
		generatedAt,
		productName: input.productName,
		stage: input.stage,
		decision: input.decision,
		rationale: input.rationale,
		evidence: input.evidence,
		...input.owner ? { owner: input.owner } : {},
		...input.nextReviewDate ? { nextReviewDate: input.nextReviewDate } : {},
		...input.source ? { source: input.source } : {},
		warnings,
		nextActions,
		markdown
	};
}
function list(value) {
	return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}
function buildChangeImpactReview(input) {
	const impacts = [
		"scope",
		"requiredCapabilities",
		"implementationConstraints",
		"successMetrics",
		"commercialContext"
	].map((area) => {
		const before = list(input.before[area]);
		const after = list(input.after[area]);
		return {
			area,
			before,
			after,
			added: after.filter((item) => !before.includes(item)),
			removed: before.filter((item) => !after.includes(item))
		};
	}).filter((item) => item.added.length > 0 || item.removed.length > 0);
	const risks = impacts.flatMap((item) => item.removed.length > 0 ? [`${item.area} 删除了 ${item.removed.length} 项，需要确认对交付和销售承诺的影响。`] : []);
	const changed = impacts.length > 0;
	const nextActions = changed ? ["让受影响的 handoff 消费者重新审查，再更新产品销售/增长交接。"] : ["没有发现受控字段变化，继续保持当前交接版本。"];
	const generatedAt = (/* @__PURE__ */ new Date()).toISOString();
	const markdown = [
		"---",
		"schemaVersion: \"1.0\"",
		"artifactType: product-change-impact-review",
		`generatedAt: ${generatedAt}`,
		"---",
		`# ${input.productName} 变更影响审查`,
		"",
		`- 是否变化：${changed ? "是" : "否"}`,
		...impacts.map((item) => `- ${item.area}：新增 ${item.added.length}，删除 ${item.removed.length}`),
		"",
		"## 风险",
		...risks.length > 0 ? risks.map((item) => `- ${item}`) : ["- 未发现删除型风险"],
		"",
		"## 下一步",
		...nextActions.map((item) => `- ${item}`),
		""
	].join("\n");
	return {
		artifactType: "product-change-impact-review",
		schemaVersion: "1.0",
		generatedAt,
		productName: input.productName,
		changed,
		impacts,
		risks,
		decision: risks.length > 0 ? "hold" : "review",
		warnings: [],
		nextActions,
		markdown
	};
}

//#endregion
//#region src/product.ts
function yaml(value) {
	if (Array.isArray(value)) return `[${value.map((item) => String(item).replace(/]/g, "\\]")).join(", ")}]`;
	if (value === void 0 || value === null) return "";
	return String(value).replace(/\r?\n/g, " ");
}
function artifactSlug(value) {
	return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "unknown";
}
function arrayInput(value, label) {
	try {
		return listValue(value);
	} catch (error) {
		throw new Error(`${label}: ${error instanceof Error ? error.message : String(error)}`);
	}
}
function artifactHeader(type, title, status, extra = {}) {
	const lines = [
		"---",
		`type: ${type}`,
		`title: ${title}`,
		`status: ${status}`
	];
	for (const [key, value] of Object.entries(extra)) lines.push(`${key}: ${yaml(value)}`);
	lines.push("---", "");
	return lines.join("\n");
}
function parseEnvelope(value) {
	const parsed = JSON.parse(value);
	const data = typeof parsed === "object" && parsed !== null && "data" in parsed ? parsed.data : parsed;
	if (typeof data !== "object" || data === null || Array.isArray(data)) throw new Error("Expected a JSON object or a dsh-product result envelope.");
	return data;
}
function buildProductBrief(input) {
	const warnings = [];
	if (input.successCriteria.length === 0) warnings.push("No success criteria supplied; the POC gate cannot be evaluated yet.");
	if (!input.valueProposition.trim()) warnings.push("Value proposition is empty; keep it as a hypothesis until the product strategy is clearer.");
	const decision = input.productGoal.trim() && input.targetUser.trim() && input.desiredOutcome.trim() && input.valueProposition.trim() && input.successCriteria.length > 0 ? "ready-for-poc" : "needs-strategy-clarification";
	const nonGoals = ["不重复开展需求发现；机会证据由 dsh-idea 或用户提供。", "不在 POC 前承诺完整产品范围。"];
	const nextActions = decision === "ready-for-poc" ? ["列出必须证明的技术、工作流和价值风险。", "为最高风险建立 POC 计划，并写明成功/失败阈值。"] : ["补齐目标、价值主张和可观察成功标准，再进入 POC。"];
	const brief = {
		...input,
		generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
		artifactType: "product-brief",
		stage: input.stage ?? "strategy",
		nonGoals,
		decision,
		warnings,
		nextActions,
		markdown: ""
	};
	brief.markdown = [
		artifactHeader("product-brief", input.productName, decision, {
			owner: input.owner,
			stage: brief.stage,
			source: input.source
		}),
		`# ${input.productName} 产品 Brief`,
		"",
		"## 产品目标",
		input.productGoal,
		"",
		"## 目标用户与结果",
		`- 目标用户：${input.targetUser}`,
		`- 期望结果：${input.desiredOutcome}`,
		"",
		"## 价值主张",
		input.valueProposition,
		"",
		"## 成功标准",
		markdownList(input.successCriteria),
		"",
		"## 约束",
		markdownList(input.constraints),
		"",
		"## 非目标",
		markdownList(nonGoals),
		"",
		"## 下一步",
		markdownList(nextActions),
		""
	].join("\n");
	return brief;
}
function buildPocPlan(input) {
	const warnings = [];
	if (input.criticalRisks.length === 0) warnings.push("No critical risk supplied; a POC without a falsifiable risk is likely to become an unfocused prototype.");
	if (!input.decisionRule.trim()) warnings.push("Decision rule is empty; define continue, revise or stop conditions before starting.");
	const nextActions = input.criticalRisks.length > 0 ? [
		"Run the smallest test for the highest impact × likelihood risk.",
		"Record raw evidence, threshold result and the decision date.",
		"Only expand scope after the POC gate is passed."
	] : ["Identify the riskiest assumption before building a prototype."];
	const plan = {
		generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
		artifactType: "poc-plan",
		productName: input.productName,
		objective: input.objective,
		criticalRisks: input.criticalRisks,
		scope: input.scope,
		nonGoals: input.nonGoals,
		method: input.method,
		duration: input.duration,
		owner: input.owner,
		decisionRule: input.decisionRule,
		warnings,
		nextActions,
		markdown: ""
	};
	plan.markdown = [
		artifactHeader("poc-plan", `${input.productName} POC`, "draft", {
			owner: input.owner,
			stage: "poc"
		}),
		`# ${input.productName} POC 计划`,
		"",
		"## POC 目标",
		input.objective,
		"",
		"## 关键风险",
		input.criticalRisks.length > 0 ? input.criticalRisks.map((risk) => `### ${risk.id}｜${risk.category}\n- 风险：${risk.statement}\n- 影响/可能性：${risk.impact} / ${risk.likelihood}\n- 测试：${risk.test}\n- 成功阈值：${risk.successCriteria}\n- 失败阈值：${risk.failureCriteria}`).join("\n\n") : "- 暂无；先补齐风险。",
		"",
		"## 范围",
		markdownList(input.scope),
		"",
		"## 非目标",
		markdownList(input.nonGoals),
		"",
		"## 方法与周期",
		`- 方法：${input.method}`,
		`- 周期：${input.duration}`,
		`- 负责人：${input.owner ?? "待指定"}`,
		"",
		"## 决策规则",
		input.decisionRule || "待补齐",
		"",
		"## 下一步",
		markdownList(nextActions),
		""
	].join("\n");
	return plan;
}
function buildMvpPlan(input) {
	const warnings = [];
	if (input.inScope.length === 0) warnings.push("MVP has no in-scope items; it is not ready for delivery planning.");
	if (input.outOfScope.length === 0) warnings.push("MVP has no explicit non-goals; scope creep risk is high.");
	if (input.acceptanceCriteria.length === 0) warnings.push("No acceptance criteria supplied; engineering and QA cannot share a finish line.");
	if (input.successMetrics.length === 0) warnings.push("No success metric supplied; launch learning cannot be evaluated.");
	const nextActions = warnings.length === 0 ? [
		"Review the core flow with design and engineering.",
		"Confirm instrumentation before implementation.",
		"Set the beta audience and decision date."
	] : ["Resolve the highest-risk missing MVP field before committing delivery capacity."];
	const plan = {
		generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
		artifactType: "mvp-plan",
		...input,
		warnings,
		nextActions,
		markdown: ""
	};
	plan.markdown = [
		artifactHeader("mvp-plan", `${input.productName} MVP`, "draft", {
			owner: input.owner,
			stage: "mvp"
		}),
		`# ${input.productName} MVP 计划`,
		"",
		"## 核心结果",
		`- 目标用户：${input.targetUser}`,
		`- 核心结果：${input.coreOutcome}`,
		"",
		"## MVP 范围",
		markdownList(input.inScope),
		"",
		"## 明确不做",
		markdownList(input.outOfScope),
		"",
		"## 用户流程",
		input.userFlow.length > 0 ? input.userFlow.map((step, index) => `${index + 1}. ${step}`).join("\n") : "- 暂无",
		"",
		"## 验收标准",
		markdownList(input.acceptanceCriteria),
		"",
		"## 成功指标与埋点",
		"**成功指标**",
		markdownList(input.successMetrics),
		"",
		"**埋点**",
		markdownList(input.instrumentation),
		"",
		"## 依赖与风险",
		"**依赖**",
		markdownList(input.dependencies),
		"",
		"**风险**",
		markdownList(input.risks),
		"",
		"## 周期与决策规则",
		`- 周期：${input.duration}`,
		`- 决策规则：${input.decisionRule || "待补齐"}`,
		"",
		"## 下一步",
		markdownList(nextActions),
		""
	].join("\n");
	return plan;
}
function buildPrd(mvp) {
	const warnings = [...mvp.warnings];
	const nextActions = [
		"完成设计评审和技术拆分。",
		"将验收标准转成测试用例。",
		"上线前回填真实结果，不把计划值当成事实。"
	];
	const markdown = [
		artifactHeader("prd", `${mvp.productName} PRD`, "draft", {
			owner: mvp.owner,
			stage: "mvp"
		}),
		`# ${mvp.productName} PRD`,
		"",
		"## 背景与目标",
		`- 目标用户：${mvp.targetUser}`,
		`- 核心结果：${mvp.coreOutcome}`,
		"",
		"## 用户流程",
		mvp.userFlow.length > 0 ? mvp.userFlow.map((step, index) => `${index + 1}. ${step}`).join("\n") : "- 暂无",
		"",
		"## 功能范围",
		"**本期包含**",
		markdownList(mvp.inScope),
		"",
		"**本期不包含**",
		markdownList(mvp.outOfScope),
		"",
		"## 验收标准",
		markdownList(mvp.acceptanceCriteria),
		"",
		"## 数据与成功指标",
		markdownList([...mvp.successMetrics, ...mvp.instrumentation.map((item) => `埋点：${item}`)]),
		"",
		"## 依赖、风险与发布决策",
		`- 依赖：${mvp.dependencies.join("；") || "暂无"}`,
		`- 风险：${mvp.risks.join("；") || "暂无"}`,
		`- 决策规则：${mvp.decisionRule || "待补齐"}`,
		"",
		"## 交付检查",
		markdownList(nextActions),
		""
	].join("\n");
	return {
		artifactType: "prd",
		productName: mvp.productName,
		markdown,
		warnings,
		nextActions
	};
}
function buildReleaseReview(input) {
	const blockers = input.checks.filter((check) => check.status === "blocker" || check.blocker).map((check) => check.name);
	const warnings = input.checks.filter((check) => check.status === "warning" || check.status === "not-checked").map((check) => `${check.name}: ${check.evidence ?? "缺少证据"}`);
	const status = blockers.length > 0 ? "blocked" : input.checks.length > 0 && input.checks.every((check) => check.status === "pass") ? "ready" : "partial";
	const decision = status === "ready" ? "release" : status === "partial" ? "release-with-conditions" : "hold";
	const nextActions = blockers.length > 0 ? blockers.map((item) => `解除发布阻塞项：${item}`) : warnings.length > 0 ? ["补齐带条件发布项的证据和负责人。", "明确上线后的回滚、反馈和观测窗口。"] : ["记录上线版本、目标人群和基线指标。", "进入 Beta/PMF 证据收集。"];
	const review = {
		generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
		artifactType: "release-review",
		productName: input.productName,
		version: input.version,
		targetAudience: input.targetAudience,
		owner: input.owner,
		launchDate: input.launchDate,
		status,
		checks: input.checks,
		blockers,
		warnings,
		decision,
		nextActions,
		markdown: ""
	};
	review.markdown = [
		artifactHeader("release-review", `${input.productName} ${input.version}`, status, {
			owner: input.owner,
			stage: "beta",
			launchDate: input.launchDate
		}),
		`# ${input.productName} ${input.version} 发布检查`,
		"",
		`- 目标人群：${input.targetAudience}`,
		`- 决策：${decision}`,
		"",
		"## 检查项",
		input.checks.length > 0 ? input.checks.map((check) => `- [${check.status === "pass" ? "x" : " "}] ${check.name}：${check.evidence ?? "缺少证据"}`).join("\n") : "- 暂无检查项",
		"",
		"## 阻塞项",
		markdownList(blockers),
		"",
		"## 下一步",
		markdownList(nextActions),
		""
	].join("\n");
	return review;
}
function boolValue(value) {
	if (typeof value === "boolean") return value;
	if (typeof value === "number") return value > 0;
	if (typeof value === "string") {
		const lower = value.trim().toLowerCase();
		if ([
			"true",
			"yes",
			"y",
			"1",
			"是",
			"有",
			"paid",
			"retained",
			"active"
		].includes(lower)) return true;
		if ([
			"false",
			"no",
			"n",
			"0",
			"否",
			"无",
			"unpaid",
			"churned",
			"inactive"
		].includes(lower)) return false;
	}
}
function rateFromRows(rows, field) {
	if (!field) return null;
	const values = rows.map((row) => row[field]).filter((value) => value !== void 0 && value !== null && value !== "");
	if (values.length === 0) return null;
	const bools = values.map(boolValue);
	if (bools.every((value) => value !== void 0)) return bools.filter((value) => value).length / values.length * 100;
	const nums = values.flatMap((value) => {
		if (typeof value === "number" && Number.isFinite(value)) return [value > 1 ? value / 100 : value];
		if (typeof value === "string" && Number.isFinite(Number(value))) {
			const number = Number(value);
			return [number > 1 ? number / 100 : number];
		}
		return [];
	});
	return nums.length > 0 ? nums.reduce((sum, value) => sum + value, 0) / nums.length * 100 : null;
}
function findField(rows, requested, candidates) {
	if (requested && rows.some((row) => Object.prototype.hasOwnProperty.call(row, requested))) return requested;
	const keys = rows.flatMap((row) => Object.keys(row));
	return candidates.find((candidate) => keys.some((key) => key.toLowerCase() === candidate.toLowerCase()));
}
function segmentRows(rows, field) {
	if (!field) return [["all", rows]];
	const groups = /* @__PURE__ */ new Map();
	for (const row of rows) {
		const key = stringValue(row, field) ?? "unknown";
		groups.set(key, [...groups.get(key) ?? [], row]);
	}
	return [...groups.entries()];
}
function reviewPmfRows(input) {
	const minSample = input.minSample ?? 5;
	const valueField = findField(input.rows, input.valueField, [
		"very_disappointed",
		"veryDisappointed",
		"would_miss",
		"wouldMiss",
		"value_signal",
		"valueSignal",
		"价值感知",
		"非常失望"
	]);
	const retentionField = findField(input.rows, input.retentionField, [
		"retained",
		"retention",
		"retention_rate",
		"retentionRate",
		"留存"
	]);
	const paidField = findField(input.rows, input.paidField, [
		"paid",
		"renewed",
		"converted",
		"purchase",
		"付费",
		"续费",
		"成交"
	]);
	const referralField = findField(input.rows, input.referralField, [
		"referred",
		"referral",
		"recommended",
		"recommendation",
		"推荐"
	]);
	const usageField = findField(input.rows, input.usageField, [
		"usage_frequency",
		"usageFrequency",
		"active_days",
		"activeDays",
		"sessions",
		"使用频率",
		"活跃天数"
	]);
	const segmentField = input.segmentField ?? findField(input.rows, void 0, [
		"segment",
		"cohort",
		"persona",
		"user_segment",
		"分群",
		"用户类型"
	]);
	const detected = [
		valueField,
		retentionField,
		paidField,
		referralField,
		usageField,
		segmentField
	].filter((field) => Boolean(field));
	const signals = [];
	const valueRate = rateFromRows(input.rows, valueField);
	const retentionRate = rateFromRows(input.rows, retentionField);
	const paidRate = rateFromRows(input.rows, paidField);
	const referralRate = rateFromRows(input.rows, referralField);
	const usageValues = usageField ? input.rows.flatMap((row) => {
		const value = numberValue(row, usageField);
		return value === void 0 ? [] : [value];
	}) : [];
	const addRateSignal = (id, label, field, rate, caveat) => {
		signals.push({
			id,
			label,
			status: rate === null ? "missing" : input.rows.length < minSample ? "partial" : "ready",
			field,
			sampleSize: input.rows.length,
			observedRate: rate,
			evidence: rate === null ? "没有检测到可计算字段。" : `观测到 ${rate.toFixed(1)}% 的记录满足该信号。`,
			caveat
		});
	};
	addRateSignal("value-perception", "价值感知", valueField, valueRate, "“非常失望/愿意失去”等 PMF 问法只是启发式信号，不能单独证明 PMF。");
	addRateSignal("retention", "持续使用/留存", retentionField, retentionRate, "留存必须结合产品周期、用户分群和时间窗口解读。");
	addRateSignal("commercial", "付费/续费", paidField, paidRate, "成交或续费是商业证据，但单笔交易不能代表可重复的产品价值。");
	addRateSignal("referral", "推荐/传播", referralField, referralRate, "推荐行为要区分主动推荐、被动分享和激励带来的传播。");
	signals.push({
		id: "usage",
		label: "使用强度",
		status: usageValues.length === 0 ? "missing" : input.rows.length < minSample ? "partial" : "ready",
		field: usageField,
		sampleSize: usageValues.length,
		observedValue: usageValues.length > 0 ? Number((usageValues.reduce((sum, value) => sum + value, 0) / usageValues.length).toFixed(2)) : null,
		evidence: usageValues.length > 0 ? `平均使用强度为 ${(usageValues.reduce((sum, value) => sum + value, 0) / usageValues.length).toFixed(2)}。` : "没有检测到使用强度字段。",
		caveat: "使用次数本身不等于用户获得了价值，应和核心结果一起看。"
	});
	const segments = segmentRows(input.rows, segmentField).map(([segment, rows]) => {
		const rates = {
			valueRate: rateFromRows(rows, valueField),
			retentionRate: rateFromRows(rows, retentionField),
			paidRate: rateFromRows(rows, paidField),
			referralRate: rateFromRows(rows, referralField)
		};
		const signalCount = Object.values(rates).filter((rate) => rate !== null).length + (usageField && rows.some((row) => numberValue(row, usageField) !== void 0) ? 1 : 0);
		const notes = [];
		if (rows.length < minSample) notes.push(`样本量 ${rows.length} 小于配置的参考值 ${minSample}，不宜做稳定判断。`);
		if (rates.valueRate !== null && rates.valueRate < 40) notes.push("价值感知低于 40% 启发式参考线，优先核查用户分群和价值兑现。");
		return {
			segment,
			sampleSize: rows.length,
			...rates,
			signalCount,
			status: signalCount >= 3 && rows.length >= minSample ? "ready" : signalCount > 0 ? "partial" : "missing",
			notes
		};
	});
	const available = signals.filter((signal) => signal.status !== "missing").length;
	const coreConvergence = valueRate !== null && (retentionRate !== null || paidRate !== null);
	const status = input.rows.length === 0 ? "blocked" : coreConvergence && available >= 3 ? "ready" : available >= 2 ? "partial" : "blocked";
	const decision = status === "ready" ? "continue" : status === "partial" ? "iterate" : input.rows.length === 0 ? "needs-more-evidence" : "pause";
	const warnings = [];
	if (input.rows.length === 0) warnings.push("PMF 数据集没有记录，无法判断。");
	if (input.rows.length > 0 && input.rows.length < minSample) warnings.push(`样本量 ${input.rows.length} 小于配置的参考值 ${minSample}；该参考值不是行业基准。`);
	if (!valueField) warnings.push("缺少价值感知字段，例如 very_disappointed、would_miss 或 value_signal。");
	if (!retentionField && !paidField) warnings.push("至少补充留存或付费/续费字段，才能形成价值之外的交叉证据。");
	const nextActions = status === "ready" ? ["按分群复核价值感知、留存和商业行为是否一致。", "将 PMF 证据转为增长交接，明确主指标和护栏指标。"] : status === "partial" ? ["补齐缺失信号，并按核心用户分群重复观察。", "把价值主张或核心流程转成下一轮产品迭代假设。"] : ["先补充真实使用、留存、付费或推荐证据，再做 PMF 判断。"];
	const review = {
		generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
		artifactType: "pmf-review",
		productName: input.productName,
		source: input.source,
		status,
		decision,
		evidenceSummary: {
			rows: input.rows.length,
			segments: segments.length,
			fieldsDetected: detected,
			convergence: coreConvergence ? "价值信号与留存/商业信号有初步交叉证据。" : "尚未形成价值信号与留存/商业信号的交叉证据。"
		},
		signals,
		segments,
		warnings,
		assumptions: ["40% 只作为 PMF Survey 的启发式参考线，不是产品市场匹配的判定标准。", "缺少时间窗口、分群定义或样本抽样说明时，结果只能作为方向性证据。"],
		nextActions,
		markdown: ""
	};
	review.markdown = renderPmfMarkdown(review);
	return review;
}
function renderPmfMarkdown(review) {
	return [
		artifactHeader("pmf-review", `${review.productName} PMF Review`, review.status, {
			stage: "pmf",
			source: review.source
		}),
		`# ${review.productName} PMF 复盘`,
		"",
		`- 状态：${review.status}`,
		`- 决策：${review.decision}`,
		`- 数据源：${review.source}`,
		`- 样本：${review.evidenceSummary.rows}`,
		`- 证据收敛：${review.evidenceSummary.convergence}`,
		"",
		"## 信号",
		review.signals.map((signal) => `- **${signal.label}**（${signal.status}）：${signal.evidence}${signal.caveat ? ` 注意：${signal.caveat}` : ""}`).join("\n"),
		"",
		"## 分群",
		review.segments.length > 0 ? review.segments.map((segment) => `- **${segment.segment}**（n=${segment.sampleSize}，${segment.status}）：价值 ${segment.valueRate ?? "-"}%，留存 ${segment.retentionRate ?? "-"}%，付费/续费 ${segment.paidRate ?? "-"}%。${segment.notes.join(" ")}`).join("\n") : "- 暂无",
		"",
		"## 限制与假设",
		markdownList(review.assumptions),
		"",
		"## 下一步",
		markdownList(review.nextActions),
		""
	].join("\n");
}
const nextStageByStage = {
	handoff: "strategy",
	strategy: "poc",
	poc: "mvp",
	mvp: "beta",
	beta: "pmf",
	pmf: "growth-handoff",
	iteration: "iteration"
};
function decisionLabel(decision) {
	return {
		proceed: "更进一步",
		iterate: "调整后继续验证",
		hold: "暂缓决策",
		abandon: "放弃或关闭当前方向",
		scale: "扩大投入"
	}[decision];
}
function gateEvidence(gate) {
	return gate.evidence?.trim() || "未提供证据";
}
function decisionGateStatus(gate) {
	return gate.status === "pass" && !gate.evidence?.trim() ? "missing" : gate.status;
}
function buildProductDecisionReview(input) {
	const scaleReady = input.scaleReady === true;
	const gates = input.gates.map((gate) => ({
		...gate,
		status: decisionGateStatus(gate)
	}));
	const evidenceSummary = {
		total: gates.length,
		pass: gates.filter((gate) => gate.status === "pass").length,
		warning: gates.filter((gate) => gate.status === "warning").length,
		fail: gates.filter((gate) => gate.status === "fail").length,
		missing: gates.filter((gate) => gate.status === "missing").length,
		blockingFailures: gates.filter((gate) => gate.status === "fail" && gate.blocking === true).length
	};
	const warnings = [];
	if (gates.length === 0) warnings.push("没有提供决策门；证据不足，不能判断继续或放弃。");
	const missingEvidence = input.gates.filter((gate) => gate.status !== "missing" && !gate.evidence?.trim()).map((gate) => gate.label);
	if (missingEvidence.length > 0) warnings.push(`以下决策门缺少证据，已按 missing 处理：${missingEvidence.join("、")}`);
	let decision;
	if (evidenceSummary.blockingFailures > 0) decision = "abandon";
	else if (evidenceSummary.fail > 0 || evidenceSummary.warning > 0) decision = "iterate";
	else if (evidenceSummary.missing > 0 || evidenceSummary.total === 0) decision = "hold";
	else if (scaleReady) decision = "scale";
	else decision = "proceed";
	const nextStage = decision === "proceed" ? nextStageByStage[input.stage] : decision === "scale" ? "growth-handoff" : void 0;
	const failed = gates.filter((gate) => gate.status === "fail");
	const missing = gates.filter((gate) => gate.status === "missing");
	const cautions = gates.filter((gate) => gate.status === "warning");
	const reasons = decision === "abandon" ? failed.filter((gate) => gate.blocking === true).map((gate) => `关键失败：${gate.label}；证据：${gateEvidence(gate)}`) : decision === "iterate" ? [...failed, ...cautions].map((gate) => `${gate.status === "fail" ? "失败" : "警告"}：${gate.label}；证据：${gateEvidence(gate)}`) : decision === "hold" ? missing.map((gate) => `缺少证据：${gate.label}；需要：${gate.threshold ?? "补充可验证结果"}`) : ["所有已提供的决策门均已通过。"];
	if (decision === "scale") reasons.push("已明确标记 scaleReady=true，且所有决策门均通过。");
	const summary = decision === "abandon" ? "存在明确的关键失败证据，不建议继续扩大投入；应记录学习并关闭或重新定义当前方向。" : decision === "iterate" ? "已有部分证据，但仍有失败或警告项；先做一轮最小修正和验证，再重新决策。" : decision === "hold" ? "证据尚不足以支持继续或放弃，先补齐缺失证据和观测窗口。" : decision === "scale" ? "关键决策门全部通过，并满足扩大投入条件；可以在护栏指标下逐步规模化。" : `当前阶段的决策门已通过，可以${nextStage ? `进入${nextStage}阶段` : "进入下一轮产品工作"}。`;
	const nextActions = decision === "abandon" ? ["记录被证伪的核心假设、失败证据和可复用学习。", "决定关闭当前方向，或回到 dsh-idea 重新定义用户、场景和问题。"] : decision === "iterate" ? [
		...failed.map((gate) => `优先修正失败项：${gate.label}。`),
		...cautions.map((gate) => `核查警告项：${gate.label}。`),
		"完成一轮最小修正后，记录新的决策日期并重新运行决策复盘。"
	] : decision === "hold" ? [...missing.map((gate) => `补齐证据：${gate.label}${gate.threshold ? `（阈值：${gate.threshold}）` : ""}。`), "在预先设定的观测窗口结束后再做继续或放弃判断。"] : decision === "scale" ? ["先在受控范围内扩大投入，并持续监控主指标和护栏指标。", "设定下一次规模化复盘日期和回滚条件。"] : [`进入${nextStage ?? "下一轮"}，只扩大已通过验证的范围。`, "设定下一次决策日期，并继续记录成功、失败和护栏证据。"];
	const assumptions = [
		"未标记 blocking=true 的失败默认进入 iterate，不自动判定为放弃。",
		"缺少证据的决策门按 missing 处理，missing 会导致 hold，而不是直接放弃。",
		"只有所有决策门通过且显式提供 scaleReady=true 时，才输出 scale。"
	];
	const review = {
		generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
		artifactType: "decision-review",
		productName: input.productName,
		stage: input.stage,
		decisionDate: input.decisionDate,
		decision,
		nextStage,
		scaleReady,
		gates,
		evidenceSummary,
		summary,
		reasons,
		warnings,
		assumptions,
		nextActions,
		markdown: ""
	};
	review.markdown = [
		artifactHeader("decision-review", `${input.productName} 产品决策`, decision, {
			stage: input.stage,
			decisionDate: input.decisionDate
		}),
		`# ${input.productName} 产品决策复盘`,
		"",
		`- 当前阶段：${input.stage}`,
		`- 决策：${decisionLabel(decision)}（${decision}）`,
		`- 决策日期：${input.decisionDate ?? "待补充"}`,
		`- 下一阶段：${nextStage ?? "暂不进入下一阶段"}`,
		"",
		"## 结论",
		summary,
		"",
		"## 决策门",
		"| 决策门 | 状态 | 阻断 | 阈值 | 证据 |",
		"| --- | --- | --- | --- | --- |",
		gates.length > 0 ? gates.map((gate) => `| ${gate.label} | ${gate.status} | ${gate.blocking === true ? "是" : "否"} | ${gate.threshold ?? "—"} | ${gateEvidence(gate)} |`).join("\n") : "| 暂无 | missing | — | — | 未提供 |",
		"",
		"## 判断依据",
		markdownList(reasons),
		"",
		"## 假设与限制",
		markdownList(assumptions),
		"",
		"## 下一步",
		markdownList(nextActions),
		""
	].join("\n");
	return review;
}
function buildGrowthHandoff(input) {
	const warnings = [];
	if (!input.primaryMetric.trim()) warnings.push("No primary growth metric supplied; handoff is incomplete.");
	if (input.evidence.length === 0) warnings.push("No product evidence supplied; do not treat the handoff as a PMF claim.");
	const nextActions = warnings.length > 0 ? ["补齐主指标和产品证据后再交接。"] : ["由增长负责人确认数据口径、分群和时间窗口。", "把产品未决问题转成增长实验或产品迭代任务。"];
	const handoff = {
		generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
		artifactType: "growth-handoff",
		productName: input.productName,
		productOutcome: input.productOutcome,
		evidence: input.evidence,
		primaryMetric: input.primaryMetric,
		guardrails: input.guardrails,
		openQuestions: input.openQuestions,
		recommendedActions: input.recommendedActions,
		owner: input.owner,
		source: input.source,
		warnings,
		nextActions,
		markdown: ""
	};
	handoff.markdown = [
		artifactHeader("growth-handoff", `${input.productName} Growth Handoff`, warnings.length === 0 ? "ready" : "partial", {
			owner: input.owner,
			stage: "growth-handoff",
			source: input.source
		}),
		`# ${input.productName} 增长交接`,
		"",
		"## 产品结果",
		input.productOutcome,
		"",
		"## 已有证据",
		markdownList(input.evidence),
		"",
		"## 增长测量",
		`- 主指标：${input.primaryMetric || "待补齐"}`,
		`- 护栏指标：${input.guardrails.join("；") || "待补齐"}`,
		"",
		"## 未决问题",
		markdownList(input.openQuestions),
		"",
		"## 推荐动作",
		markdownList(input.recommendedActions),
		"",
		"## 交接下一步",
		markdownList(nextActions),
		""
	].join("\n");
	return handoff;
}
function buildProductSalesHandoff(input) {
	const warnings = [];
	if (input.valueEvidence.length === 0) warnings.push("缺少价值证据；销售不得把产品描述当成客户价值证明。");
	if (input.proofPoints.length === 0) warnings.push("缺少可核验 proof points；需要补充结果、客户原话或使用证据。");
	if (input.commercialContext.length === 0) warnings.push("缺少商业上下文；报价、成本和折扣边界必须由 dsh-business 或用户提供。");
	if (!input.nextCustomerAction.trim()) warnings.push("缺少客户下一步动作；当前交接不能直接进入成交推进。");
	const status = warnings.length === 0 ? "ready" : "partial";
	const nextActions = status === "ready" ? ["交给 dsh-sales 做资格判断和商机推进；不要在销售插件内重新定义产品范围。", "由 dsh-business 核对价格底线、成本基础、付款和折扣授权。"] : ["补齐价值证据、proof points、商业上下文和客户下一步动作，再交给 dsh-sales。"];
	const generatedAt = (/* @__PURE__ */ new Date()).toISOString();
	const artifactId = `dsh-product-sales-${artifactSlug(input.productName)}-${generatedAt.slice(0, 10)}`;
	const handoff = {
		schemaVersion: "1.0",
		artifactId,
		handoffVersion: "1.0",
		artifactType: "product-sales-handoff",
		handoffFrom: "dsh-product",
		handoffTo: "dsh-sales",
		generatedAt,
		status,
		productDecision: input.productDecision,
		productName: input.productName,
		targetBuyer: input.targetBuyer,
		customerProblem: input.customerProblem,
		desiredOutcome: input.desiredOutcome,
		valueEvidence: input.valueEvidence,
		proofPoints: input.proofPoints,
		requiredCapabilities: input.requiredCapabilities,
		implementationConstraints: input.implementationConstraints,
		commercialContext: input.commercialContext,
		commercialQuestions: input.commercialQuestions,
		nextCustomerAction: input.nextCustomerAction,
		owner: input.owner,
		source: input.source,
		warnings,
		nextActions,
		markdown: ""
	};
	handoff.markdown = [
		[
			"---",
			"schemaVersion: \"1.0\"",
			`artifactId: ${yaml(artifactId)}`,
			"handoffVersion: \"1.0\"",
			"artifactType: product-sales-handoff",
			"handoffFrom: dsh-product",
			"handoffTo: dsh-sales",
			`status: ${status}`,
			`productDecision: ${input.productDecision}`,
			...input.owner ? [`owner: ${yaml(input.owner)}`] : [],
			...input.source ? [`source: ${yaml(input.source)}`] : [],
			"---",
			"",
			`# ${input.productName} 产品销售交接`,
			""
		].join("\n"),
		`# ${input.productName} 产品销售交接`,
		"",
		"## 交接结论",
		`- 产品决策：${input.productDecision}`,
		`- 目标买方：${input.targetBuyer || "待补充"}`,
		`- 客户问题：${input.customerProblem || "待补充"}`,
		`- 期望结果：${input.desiredOutcome || "待补充"}`,
		`- 客户下一步：${input.nextCustomerAction || "待补充"}`,
		"",
		"## 价值证据",
		markdownList(input.valueEvidence),
		"",
		"## Proof points",
		markdownList(input.proofPoints),
		"",
		"## 交付边界",
		"**必须具备**",
		markdownList(input.requiredCapabilities),
		"",
		"**约束**",
		markdownList(input.implementationConstraints),
		"",
		"## 商业上下文",
		markdownList(input.commercialContext),
		"",
		"## 待确认商业问题",
		markdownList(input.commercialQuestions),
		"",
		"## 交接纪律",
		"- dsh-sales 负责资格判断、推进、报价审查和成交动作，不扩大产品承诺。",
		"- 价格底线、成本基础和折扣权限必须有 dsh-business 或用户提供的证据。",
		"",
		"## 风险与下一步",
		markdownList(warnings),
		markdownList(nextActions),
		""
	].join("\n");
	return handoff;
}
function mvpFromJson(value) {
	const data = parseEnvelope(value);
	if (data.artifactType !== "mvp-plan" || typeof data.productName !== "string") throw new Error("mvpJson must contain a product_mvp_plan result.");
	return data;
}
function releaseChecksFromJson(value) {
	const parsed = JSON.parse(value);
	if (!Array.isArray(parsed)) throw new Error("checks must be a JSON array.");
	return parsed.map((item, index) => {
		if (typeof item !== "object" || item === null) throw new Error(`checks[${index}] must be an object.`);
		const record = item;
		const status = String(record.status ?? "not-checked");
		if (![
			"pass",
			"warning",
			"blocker",
			"not-checked"
		].includes(status)) throw new Error(`checks[${index}].status is invalid.`);
		return {
			name: String(record.name ?? `check-${index + 1}`),
			status,
			evidence: record.evidence ? String(record.evidence) : void 0,
			owner: record.owner ? String(record.owner) : void 0,
			blocker: record.blocker === true
		};
	});
}

//#endregion
//#region src/output.ts
const resultSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		schemaVersion: { type: "string" },
		ok: { type: "boolean" },
		data: { type: "json" },
		warnings: {
			type: "array",
			items: { type: "string" }
		},
		assumptions: {
			type: "array",
			items: { type: "string" }
		},
		lineage: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: true
			}
		},
		nextActions: {
			type: "array",
			items: { type: "string" }
		}
	}
};
function resultEnvelope(options) {
	return {
		schemaVersion: "1.0",
		ok: true,
		data: options.data,
		warnings: [...options.warnings ?? []],
		assumptions: [...options.assumptions ?? []],
		lineage: [...options.lineage ?? []],
		nextActions: [...options.nextActions ?? []]
	};
}
function jsonValue(value) {
	return JSON.parse(JSON.stringify(value));
}
function renderResult(value, maxChars) {
	const text$1 = JSON.stringify(value, null, 2);
	return [{
		type: "text",
		text: text$1.length > maxChars ? `${text$1.slice(0, maxChars)}\n... result truncated by dsh-product; use a narrower source or scope ...` : text$1
	}];
}

//#endregion
//#region src/reports.ts
function renderProductReport(review) {
	const onboarding = review.onboarding;
	const dimensions = onboarding.dimensions.map((dimension) => `| ${dimension.label} | ${dimension.status} | ${dimension.evidence.join("<br>") || "暂无"} | ${dimension.nextAction} |`).join("\n");
	const pmf = review.pmf ? [
		"## PMF 证据",
		`- 状态：${review.pmf.status}`,
		`- 决策：${review.pmf.decision}`,
		`- 样本量：${review.pmf.evidenceSummary.rows}`,
		`- 证据收敛：${review.pmf.evidenceSummary.convergence}`,
		"",
		...review.pmf.signals.map((signal) => `- ${signal.label}（${signal.status}）：${signal.evidence}`),
		""
	].join("\n") : "## PMF 证据\n\n本次没有接入 PMF 数据集。\n";
	const decision = review.decisionReview ? [
		"## 产品决策",
		`- 阶段：${review.decisionReview.stage}`,
		`- 决策：${review.decisionReview.decision}`,
		`- 结论：${review.decisionReview.summary}`,
		"",
		...review.decisionReview.reasons.map((reason) => `- ${reason}`),
		""
	].join("\n") : "## 产品决策\n\n本次没有接入独立的产品决策复盘。\n";
	const reportMarkdown = [
		`# 产品落地复盘：${review.root}`,
		"",
		`- 当前步骤：${review.currentStep}`,
		`- 总体状态：${onboarding.overallStatus}`,
		`- 准备度：${onboarding.overallScore}%`,
		`- 决策：${review.decision}`,
		"",
		decision,
		"## 流程准备度",
		"",
		"| 阶段 | 状态 | 当前证据 | 下一步 |",
		"| --- | --- | --- | --- |",
		dimensions || "| 暂无 | missing | 暂无 | 先建立产品上下文 |",
		"",
		pmf,
		"## 主要警告",
		review.warnings.length > 0 ? review.warnings.map((warning) => `- ${warning}`).join("\n") : "- 暂无",
		"",
		"## 下一步",
		review.nextActions.length > 0 ? review.nextActions.map((action) => `- ${action}`).join("\n") : "- 暂无",
		""
	].join("\n");
	return {
		title: `产品落地复盘：${review.root}`,
		reportMarkdown,
		warnings: review.warnings,
		nextActions: review.nextActions
	};
}

//#endregion
//#region src/vault.ts
const supported = new Set([
	".md",
	".markdown",
	".csv",
	".json",
	".jsonl",
	".ndjson"
]);
function extension(path) {
	return path.match(/\.[^.\\/]+$/)?.[0]?.toLowerCase() ?? "";
}
function childPath(parent, name$1) {
	return `${parent.replace(/[\\/]+$/, "")}\\${name$1}`;
}
function isProductNote(note) {
	if (note.artifactType) return true;
	return /product|产品|POC|MVP|PMF|PRD|beta|试点|roadmap|路线图|上线|发布/i.test(note.content);
}
function typeFromNote(note) {
	return note.artifactType ?? "product-context";
}
function noteReasons(note) {
	const reasons = [];
	if (!note.frontmatter.type) reasons.push("missing type");
	if (!note.frontmatter.status) reasons.push("missing status");
	if (!note.frontmatter.updated) reasons.push("missing updated date");
	if (!note.frontmatter.owner) reasons.push("missing owner");
	if (note.externalLinks.length === 0 && !note.frontmatter.source) reasons.push("missing source or lineage");
	return reasons.length > 0 ? reasons : ["healthy"];
}
async function readProductNote(fs, path, config, signal) {
	const target = await fs.resolve(path, { signal });
	const info = await fs.stat(target, signal);
	if (!info || info.type !== "file") throw new Error(`Markdown file not found: ${path}`);
	if ((info.size ?? 0) > config.maxFileBytes) throw new Error(`File exceeds maxFileBytes (${config.maxFileBytes})`);
	const content = await fs.readText(target, signal);
	if (content.length > config.maxTextChars) throw new Error(`File exceeds maxTextChars (${config.maxTextChars})`);
	return parseNote(path, content);
}
async function scanProductVault(fs, root, config, signal) {
	const files = [];
	const productNotes = [];
	const dataFiles = [];
	const errors = [];
	let skippedFiles = 0;
	const walk = async (currentPath, currentTarget) => {
		if (files.length >= config.maxFiles) return;
		let entries;
		try {
			entries = await fs.listDir(currentTarget, signal);
		} catch (error) {
			errors.push(`${currentPath}: ${error instanceof Error ? error.message : String(error)}`);
			return;
		}
		for (const entry of entries) {
			if (files.length >= config.maxFiles) break;
			const path = childPath(currentPath, entry.name);
			if (entry.type === "directory") {
				if (entry.name.startsWith(".")) continue;
				await walk(path, entry.target);
				continue;
			}
			const ext = extension(entry.name);
			if (!supported.has(ext)) {
				skippedFiles += 1;
				continue;
			}
			if ((entry.size ?? 0) > config.maxFileBytes) {
				files.push({
					path,
					extension: ext,
					size: entry.size ?? 0,
					status: "skipped",
					reason: `exceeds maxFileBytes (${config.maxFileBytes})`
				});
				continue;
			}
			if (ext !== ".md" && ext !== ".markdown") {
				files.push({
					path,
					extension: ext,
					size: entry.size ?? 0,
					status: "supported"
				});
				if (/pmf|retention|usage|survey|beta|product|event|metric/i.test(path)) dataFiles.push(path);
				continue;
			}
			try {
				const content = await fs.readText(entry.target, signal);
				if (content.length > config.maxTextChars) {
					files.push({
						path,
						extension: ext,
						size: entry.size ?? 0,
						status: "skipped",
						reason: `exceeds maxTextChars (${config.maxTextChars})`
					});
					continue;
				}
				const note = parseNote(path, content);
				if (!isProductNote(note)) continue;
				const artifactType = typeFromNote(note);
				const reasons = noteReasons(note);
				files.push({
					path,
					extension: ext,
					size: entry.size ?? 0,
					status: "supported",
					artifactType
				});
				productNotes.push({
					path,
					title: note.title,
					artifactType,
					status: String(note.frontmatter.status ?? "unstated"),
					reasons
				});
			} catch (error) {
				files.push({
					path,
					extension: ext,
					size: entry.size ?? 0,
					status: "error",
					reason: error instanceof Error ? error.message : String(error)
				});
				errors.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
	};
	await walk(root, await fs.resolve(root, { signal }));
	const byType = {};
	const byStatus = {};
	for (const note of productNotes) {
		byType[note.artifactType] = (byType[note.artifactType] ?? 0) + 1;
		byStatus[note.status] = (byStatus[note.status] ?? 0) + 1;
	}
	return {
		root,
		generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
		files,
		productNotes,
		dataFiles,
		skippedFiles,
		errors,
		byType,
		byStatus
	};
}

//#endregion
//#region src/web.ts
function decodeEntities(value) {
	return value.replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, "\"").replace(/&#39;/gi, "'");
}
function cleanText(value) {
	return decodeEntities(value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
}
function metaContent(html, name$1) {
	const pattern = new RegExp(`<meta[^>]+(?:name|property)=["']${name$1}["'][^>]+content=["']([^"']*)["'][^>]*>`, "i");
	const reversePattern = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["']${name$1}["'][^>]*>`, "i");
	return cleanText(pattern.exec(html)?.[1] ?? reversePattern.exec(html)?.[1] ?? "");
}
function htmlSnapshot(html, maxChars) {
	return {
		title: cleanText(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? ""),
		description: metaContent(html, "description"),
		headings: [...html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)].map((match) => cleanText(match[1] ?? "")).filter(Boolean).slice(0, 20),
		excerpt: cleanText(html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")).slice(0, maxChars)
	};
}
function isPublicUrl(value) {
	try {
		const url = new URL(value);
		return url.protocol === "http:" || url.protocol === "https:";
	} catch {
		return false;
	}
}
function sourceType(url, purpose) {
	const host = new URL(url).hostname.toLowerCase();
	if (purpose === "regulation") return "regulation";
	if (purpose === "competitor" || purpose === "pricing-packaging") return host.includes("g2") || host.includes("capterra") ? "market-data" : "competitor";
	if (purpose === "market-context") return host.includes("statista") || host.includes("gartner") || host.includes("forrester") ? "market-data" : "news";
	if (host.includes("github") || host.includes("reddit") || host.includes("news.ycombinator") || host.includes("forum")) return "community";
	if (host.includes("arxiv") || host.includes("researchgate") || host.includes("scholar.google")) return "research";
	if (host.includes("gov") || host.includes("iso.org") || host.includes("standards")) return "regulation";
	if (host.includes("news") || host.includes("techcrunch") || host.includes("theverge")) return "news";
	if (host.includes("g2") || host.includes("capterra") || host.includes("appsumo")) return "market-data";
	return "official";
}
function normalizeUrl(value) {
	try {
		const url = new URL(value);
		url.hash = "";
		return url.toString();
	} catch {
		return value.trim();
	}
}
function sourceFromSearch(source, query, purpose) {
	const url = normalizeUrl(source.url);
	return {
		url,
		query,
		title: source.title?.trim() || new URL(url).hostname,
		snippet: source.snippet?.trim() || "搜索提供方未返回摘要；需要打开原文核验。",
		publishedAt: source.publishedAt,
		sourceType: sourceType(url, purpose),
		evidenceBoundary: "搜索结果标题/摘要只能支持定性线索；关键事实、数字和时间点必须打开原文核验。"
	};
}
async function searchProductSources(web, queries, purpose, config, signal) {
	const requestedQueries = [...new Set(queries.map((query) => query.trim()).filter(Boolean))];
	const selectedQueries = requestedQueries.slice(0, config.maxResearchQueries);
	const warnings = [];
	const sources = [];
	const providerContent = [];
	for (const query of selectedQueries) try {
		const result = await web.search({
			query,
			maxResults: config.maxResearchResults
		}, signal);
		sources.push(...result.sources.map((source) => sourceFromSearch(source, query, purpose)));
		if (result.content?.trim()) providerContent.push(result.content.trim().slice(0, config.maxResearchChars));
		if (result.truncated) warnings.push(`Search results for '${query}' were truncated to ${config.maxResearchResults}.`);
	} catch (error) {
		warnings.push(`Could not search '${query}': ${error instanceof Error ? error.message : String(error)}`);
	}
	if (requestedQueries.length > config.maxResearchQueries) warnings.push(`Only the first ${config.maxResearchQueries} research queries were executed.`);
	const uniqueSources = [...new Map(sources.map((source) => [source.url, source])).values()];
	const searchStatus = uniqueSources.length === 0 ? "unavailable" : warnings.length > 0 ? "partial" : "ready";
	return {
		generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
		queries: selectedQueries,
		purpose,
		sources: uniqueSources,
		providerContent: providerContent.length > 0 ? providerContent : void 0,
		searchStatus,
		warnings,
		assumptions: ["本次查询只使用公开 HTTP(S) 资讯；未将 defaultRoot 下的本地文件自动发送给网络提供方。", "搜索摘要是线索，不是已经核验的事实；产品决策必须保留原文 URL、发布时间和证据边界。"],
		nextActions: uniqueSources.length > 0 ? ["打开官方、一手或原始研究来源，核验关键事实、发布日期、适用范围和限制。", "将核验后的证据挂到 Product Brief、POC 风险或决策门，而不是直接把搜索热度当作需求证据。"] : ["检查 Web 搜索提供方是否已配置；如果资讯不可访问，明确标记为缺证据，不要用猜测替代。"]
	};
}
async function scanProductSources(web, urls, purpose, config, signal) {
	const requestedUrls = [...new Set(urls.map((url) => url.trim()).filter(Boolean))];
	const selectedUrls = requestedUrls.slice(0, config.maxResearchQueries * config.maxResearchResults);
	const warnings = [];
	const sources = [];
	for (const value of selectedUrls) {
		if (!isPublicUrl(value)) {
			warnings.push(`Skipped invalid public URL '${value}'; only HTTP(S) URLs are supported.`);
			continue;
		}
		const url = normalizeUrl(value);
		try {
			const result = await web.fetch({ url }, signal);
			const extracted = result.body.kind === "html" ? htmlSnapshot(result.body.content, config.maxResearchChars) : {
				title: "",
				description: "",
				headings: [],
				excerpt: cleanText(result.body.content).slice(0, config.maxResearchChars)
			};
			const statusWarning = result.statusCode >= 400 ? [`HTTP status ${result.statusCode}`] : [];
			warnings.push(...statusWarning.map((warning) => `${url}: ${warning}`));
			sources.push({
				url,
				title: extracted.title || new URL(url).hostname,
				snippet: extracted.description || extracted.excerpt.slice(0, 500),
				sourceType: sourceType(url, purpose),
				evidenceBoundary: "公开 URL 的有限快照；页面可能动态渲染、需要登录或因长度限制而不完整，关键事实仍需人工核验。",
				fetchedAt: (/* @__PURE__ */ new Date()).toISOString(),
				statusCode: result.statusCode,
				headings: extracted.headings,
				excerpt: extracted.excerpt,
				contentKind: result.body.kind,
				truncated: result.truncated || result.body.content.length > config.maxResearchChars
			});
		} catch (error) {
			warnings.push(`Could not fetch '${url}': ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	if (requestedUrls.length > selectedUrls.length) warnings.push(`Only the first ${selectedUrls.length} public URLs were scanned.`);
	return {
		generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
		purpose,
		sources,
		warnings,
		assumptions: ["只读取用户明确提供的公开 HTTP(S) URL；不会携带 Cookie、登录态或本地项目文件。", "页面快照已做长度限制；动态页面、登录页和被阻断页面可能无法代表完整内容。"],
		nextActions: sources.length > 0 ? ["核验页面发布时间、作者/机构、原始数据和适用范围，再将证据绑定到产品阶段 gate。"] : ["检查 URL 是否公开可访问；无法访问的来源应保留为缺口，不要假设其内容。"]
	};
}

//#endregion
//#region src/tools.ts
function productOutput(maxChars) {
	return {
		schema: resultSchema,
		render: (_args, value) => renderResult(value, maxChars)
	};
}
function wrapResult(value, options = {}) {
	const warnings = typeof value === "object" && value !== null && "warnings" in value && Array.isArray(value.warnings) ? value.warnings.filter((warning) => typeof warning === "string") : [];
	return resultEnvelope({
		data: jsonValue(value),
		warnings,
		assumptions: options.assumptions,
		lineage: options.lineage,
		nextActions: options.nextActions
	});
}
function parseObject(value, label) {
	let parsed;
	try {
		parsed = JSON.parse(value);
	} catch (error) {
		throw new Error(`${label} must be valid JSON: ${error instanceof Error ? error.message : String(error)}`);
	}
	const data = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) && "data" in parsed ? parsed.data : parsed;
	if (typeof data !== "object" || data === null || Array.isArray(data)) throw new Error(`${label} must be a JSON object`);
	return data;
}
async function ensureInsideRoot(fs, config, path, signal) {
	const root = await fs.resolve(config.defaultRoot, { signal });
	const target = await fs.resolve(path, { signal });
	if (!fs.contains(root, target)) throw new Error(`Path is outside configured defaultRoot: ${path}`);
}
function validStage(value) {
	if (!value || value === "strategy") return "strategy";
	if (value === "handoff") return "handoff";
	throw new Error(`stage must be strategy or handoff; received '${value}'`);
}
function pocRisksFromJson(value) {
	const parsed = JSON.parse(value);
	if (!Array.isArray(parsed)) throw new Error("risks must be a JSON array.");
	return parsed.map((item, index) => {
		if (typeof item !== "object" || item === null) throw new Error(`risks[${index}] must be an object.`);
		const record = item;
		const category = String(record.category ?? "value");
		const impact = String(record.impact ?? "high");
		const likelihood = String(record.likelihood ?? "medium");
		if (![
			"technical",
			"workflow",
			"value",
			"operational",
			"compliance"
		].includes(category)) throw new Error(`risks[${index}].category is invalid.`);
		if (![
			"high",
			"medium",
			"low"
		].includes(impact) || ![
			"high",
			"medium",
			"low"
		].includes(likelihood)) throw new Error(`risks[${index}] impact/likelihood is invalid.`);
		return {
			id: String(record.id ?? `R${index + 1}`),
			category,
			statement: String(record.statement ?? record.risk ?? ""),
			impact,
			likelihood,
			test: String(record.test ?? ""),
			successCriteria: String(record.successCriteria ?? record.success ?? ""),
			failureCriteria: String(record.failureCriteria ?? record.failure ?? ""),
			owner: record.owner ? String(record.owner) : void 0
		};
	});
}
function releaseChecks(value) {
	return releaseChecksFromJson(value);
}
function decisionGates(value) {
	const parsed = JSON.parse(value);
	if (!Array.isArray(parsed)) throw new Error("gates must be a JSON array.");
	return parsed.map((item, index) => {
		if (typeof item !== "object" || item === null) throw new Error(`gates[${index}] must be an object.`);
		const record = item;
		const status = String(record.status ?? "missing");
		if (![
			"pass",
			"warning",
			"fail",
			"missing"
		].includes(status)) throw new Error(`gates[${index}].status is invalid.`);
		const label = String(record.label ?? record.name ?? "").trim();
		if (!label) throw new Error(`gates[${index}].label is required.`);
		return {
			id: String(record.id ?? `G${index + 1}`),
			label,
			status,
			evidence: record.evidence === void 0 || record.evidence === null ? void 0 : String(record.evidence),
			threshold: record.threshold === void 0 || record.threshold === null ? void 0 : String(record.threshold),
			blocking: record.blocking === true,
			owner: record.owner === void 0 || record.owner === null ? void 0 : String(record.owner)
		};
	});
}
function productStage(value) {
	const stage = value?.trim() || "strategy";
	const allowed = [
		"handoff",
		"strategy",
		"poc",
		"mvp",
		"beta",
		"pmf",
		"iteration",
		"growth-handoff"
	];
	if (!allowed.includes(stage)) throw new Error(`stage must be one of: ${allowed.join(", ")}; received '${stage}'`);
	return stage;
}
function researchPurpose(value) {
	const purpose = value?.trim() || "other";
	const allowed = [
		"product-method",
		"technical-feasibility",
		"competitor",
		"market-context",
		"regulation",
		"pricing-packaging",
		"release-notes",
		"other"
	];
	if (!allowed.includes(purpose)) throw new Error(`purpose must be one of: ${allowed.join(", ")}; received '${purpose}'`);
	return purpose;
}
function reviewFromJson(value) {
	const data = parseEnvelope(value);
	if (!("onboarding" in data) || !("currentStep" in data)) throw new Error("reviewJson must contain a product_review result.");
	return data;
}
function decisionReviewFromJson(value) {
	const data = parseEnvelope(value);
	if (data.artifactType !== "decision-review" || typeof data.productName !== "string" || typeof data.decision !== "string") throw new Error("decisionJson must contain a product_decision_review result.");
	return data;
}
function registerProductTools(ctx, config, fs, web) {
	ctx.tools.register(defineTool({
		name: "product_beta_feedback_import",
		description: "Import user-approved Beta feedback, redact common contact identifiers before analysis, and group only the redacted text into themes. It never returns raw customer rows to an external provider.",
		parameters: {
			feedbackJson: {
				type: "string",
				required: true,
				description: "JSON array or object with a feedback array. Each item needs text, feedback, comment or content."
			},
			source: {
				type: "string",
				description: "Source path or feedback export label."
			}
		},
		output: productOutput(config.maxResultChars),
		async execute(args) {
			let parsed;
			try {
				parsed = JSON.parse(args.feedbackJson);
			} catch (error) {
				throw new Error(`feedbackJson must be valid JSON: ${error instanceof Error ? error.message : String(error)}`);
			}
			const data = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) && "data" in parsed ? parsed.data : parsed;
			const feedback = Array.isArray(data) ? data : typeof data === "object" && data !== null && "feedback" in data ? data.feedback : void 0;
			if (!Array.isArray(feedback)) throw new Error("feedbackJson must be an array or an object with a feedback array.");
			const result = buildBetaFeedbackImport({
				feedback,
				source: args.source
			});
			return wrapResult(result, {
				lineage: args.source ? [{ source: args.source }] : [],
				nextActions: result.nextActions
			});
		}
	}));
	ctx.tools.register(defineTool({
		name: "product_decision_log",
		description: "Create a versioned product decision log with an artifact id, evidence, owner and next review date. It records a decision; it does not approve release or investment by itself.",
		parameters: {
			productName: {
				type: "string",
				required: true
			},
			stage: {
				type: "string",
				required: true,
				enum: [
					"handoff",
					"strategy",
					"poc",
					"mvp",
					"beta",
					"pmf",
					"iteration",
					"growth-handoff"
				]
			},
			decision: {
				type: "string",
				required: true,
				enum: [
					"proceed",
					"iterate",
					"hold",
					"abandon",
					"scale"
				]
			},
			rationale: {
				type: "string",
				required: true
			},
			evidence: {
				type: "string",
				description: "JSON array or newline-separated evidence."
			},
			owner: { type: "string" },
			nextReviewDate: { type: "string" },
			source: { type: "string" }
		},
		output: productOutput(config.maxResultChars),
		async execute(args) {
			const result = buildProductDecisionLog({
				productName: args.productName,
				stage: productStage(args.stage),
				decision: args.decision,
				rationale: args.rationale,
				evidence: arrayInput(args.evidence, "evidence"),
				owner: args.owner,
				nextReviewDate: args.nextReviewDate,
				source: args.source
			});
			return wrapResult(result, {
				lineage: args.source ? [{ source: args.source }] : [],
				nextActions: result.nextActions
			});
		}
	}));
	ctx.tools.register(defineTool({
		name: "product_change_impact_review",
		description: "Compare two product handoff or scope objects and expose added/removed capabilities, constraints, metrics and commercial context before consumers rely on stale evidence.",
		parameters: {
			productName: {
				type: "string",
				required: true
			},
			beforeJson: {
				type: "string",
				required: true
			},
			afterJson: {
				type: "string",
				required: true
			}
		},
		output: productOutput(config.maxResultChars),
		async execute(args) {
			const result = buildChangeImpactReview({
				productName: args.productName,
				before: parseObject(args.beforeJson, "beforeJson"),
				after: parseObject(args.afterJson, "afterJson")
			});
			return wrapResult(result, { nextActions: result.nextActions });
		}
	}));
	ctx.tools.register(defineTool({
		name: "product_research",
		description: "Query current public internet information for product methods, technical feasibility, competitors, market context, regulations, pricing or release notes. Returns bounded sources and evidence boundaries; it does not perform demand discovery or treat search popularity as demand proof.",
		parameters: {
			queries: {
				type: "string",
				required: true,
				description: "JSON array or newline-separated research questions."
			},
			purpose: {
				type: "string",
				description: "product-method, technical-feasibility, competitor, market-context, regulation, pricing-packaging, release-notes or other."
			},
			maxResults: {
				type: "number",
				description: "Maximum sources per query; bounded by configuration."
			}
		},
		output: productOutput(config.maxResultChars),
		async execute(args, exec) {
			if (!web) throw new Error("No web provider is available; configure a web search provider and retry.");
			const result = await searchProductSources(web, arrayInput(args.queries, "queries"), researchPurpose(args.purpose), {
				...config,
				maxResearchResults: Math.min(config.maxResearchResults, Math.max(1, Math.floor(args.maxResults ?? config.maxResearchResults)))
			}, exec.signal);
			return wrapResult(result, {
				lineage: result.sources.map((source) => ({ source: source.url })),
				assumptions: result.assumptions,
				nextActions: result.nextActions
			});
		}
	}));
	ctx.tools.register(defineTool({
		name: "product_source_scan",
		description: "Fetch explicitly supplied public HTTP(S) product sources such as official documentation, release notes, standards or competitor pricing pages. It does not use cookies, login sessions or local files.",
		parameters: {
			urls: {
				type: "string",
				required: true,
				description: "JSON array or newline-separated public HTTP(S) URLs."
			},
			purpose: {
				type: "string",
				description: "product-method, technical-feasibility, competitor, market-context, regulation, pricing-packaging, release-notes or other."
			}
		},
		output: productOutput(config.maxResultChars),
		async execute(args, exec) {
			if (!web) throw new Error("No web provider is available; configure a web fetch provider and retry.");
			const result = await scanProductSources(web, arrayInput(args.urls, "urls"), researchPurpose(args.purpose), config, exec.signal);
			return wrapResult(result, {
				lineage: result.sources.map((source) => ({ source: source.url })),
				assumptions: result.assumptions,
				nextActions: result.nextActions
			});
		}
	}));
	ctx.tools.register(defineTool({
		name: "product_onboarding",
		description: "Run a read-only product-delivery readiness check across local product notes and evidence files. It starts after opportunity handoff and does not perform demand discovery.",
		parameters: { root: {
			type: "string",
			description: "Optional directory under defaultRoot."
		} },
		output: productOutput(config.maxResultChars),
		async execute(args, exec) {
			const root = args.root?.trim() || config.defaultRoot;
			await ensureInsideRoot(fs, config, root, exec.signal);
			const result = buildProductOnboarding({
				root,
				scan: await scanProductVault(fs, root, config, exec.signal)
			});
			return wrapResult(result, {
				lineage: [{ source: root }],
				nextActions: result.topActions
			});
		}
	}));
	ctx.tools.register(defineTool({
		name: "product_audit_note",
		description: "Audit one Markdown product artifact for stage, metadata, evidence lineage and delivery-gate completeness. Reads only.",
		parameters: { path: {
			type: "string",
			required: true,
			description: "Markdown product artifact under defaultRoot."
		} },
		output: productOutput(config.maxResultChars),
		async execute(args, exec) {
			await ensureInsideRoot(fs, config, args.path, exec.signal);
			const note = await readProductNote(fs, args.path, config, exec.signal);
			const missing = [];
			if (!note.artifactType) missing.push("artifact type");
			if (!note.frontmatter.status) missing.push("status");
			if (!note.frontmatter.owner) missing.push("owner");
			if (!note.frontmatter.updated) missing.push("updated date");
			if (!note.frontmatter.source && note.externalLinks.length === 0) missing.push("source or lineage");
			const result = {
				path: note.path,
				title: note.title,
				artifactType: note.artifactType ?? "unknown",
				status: missing.length === 0 ? "ready" : missing.length <= 2 ? "partial" : "missing",
				headings: note.headings,
				wordCount: note.wordCount,
				missing,
				warnings: missing.length > 0 ? [`Missing product artifact fields: ${missing.join(", ")}`] : [],
				nextActions: missing.length > 0 ? ["补齐缺失字段，再进入对应产品阶段的 gate。"] : ["复核内容中的事实、假设、阈值和决策日期。"]
			};
			return wrapResult(result, {
				lineage: [{ source: args.path }],
				nextActions: result.nextActions
			});
		}
	}));
	ctx.tools.register(defineTool({
		name: "product_brief",
		description: "Turn an already-confirmed opportunity handoff into a product brief with outcome, value proposition, success criteria and explicit non-goals. Does not discover demand.",
		parameters: {
			productName: {
				type: "string",
				required: true,
				description: "Product or product slice name."
			},
			productGoal: {
				type: "string",
				required: true,
				description: "Product outcome to create or improve."
			},
			targetUser: {
				type: "string",
				required: true,
				description: "Target user or buyer supplied by the opportunity handoff."
			},
			desiredOutcome: {
				type: "string",
				required: true,
				description: "Observable user or business outcome."
			},
			valueProposition: {
				type: "string",
				required: true,
				description: "Current product value hypothesis."
			},
			successCriteria: {
				type: "string",
				required: true,
				description: "JSON array or newline-separated product success criteria."
			},
			constraints: {
				type: "string",
				description: "JSON array or newline-separated constraints."
			},
			owner: {
				type: "string",
				description: "Product owner."
			},
			stage: {
				type: "string",
				description: "handoff or strategy; defaults to strategy."
			},
			source: {
				type: "string",
				description: "Opportunity handoff or source note path."
			}
		},
		output: productOutput(config.maxResultChars),
		async execute(args) {
			const brief = buildProductBrief({
				productName: args.productName,
				productGoal: args.productGoal,
				targetUser: args.targetUser,
				desiredOutcome: args.desiredOutcome,
				valueProposition: args.valueProposition,
				successCriteria: arrayInput(args.successCriteria, "successCriteria"),
				constraints: arrayInput(args.constraints, "constraints"),
				owner: args.owner,
				stage: validStage(args.stage),
				source: args.source
			});
			return wrapResult(brief, {
				lineage: args.source ? [{ source: args.source }] : [],
				nextActions: brief.nextActions
			});
		}
	}));
	ctx.tools.register(defineTool({
		name: "product_poc_plan",
		description: "Create a focused POC plan that tests the highest-risk technical, workflow, value, operational or compliance assumption with explicit thresholds.",
		parameters: {
			productName: {
				type: "string",
				required: true,
				description: "Product or slice name."
			},
			objective: {
				type: "string",
				required: true,
				description: "What the POC must prove or disprove."
			},
			risks: {
				type: "string",
				required: true,
				description: "JSON array of risks with id/category/statement/impact/likelihood/test/successCriteria/failureCriteria."
			},
			scope: {
				type: "string",
				description: "JSON array or newline-separated POC scope."
			},
			nonGoals: {
				type: "string",
				description: "JSON array or newline-separated non-goals."
			},
			method: {
				type: "string",
				required: true,
				description: "POC method, such as technical spike, concierge workflow or prototype test."
			},
			duration: {
				type: "string",
				required: true,
				description: "Expected POC duration."
			},
			owner: {
				type: "string",
				description: "POC owner."
			},
			decisionRule: {
				type: "string",
				required: true,
				description: "Continue, revise or stop rule."
			}
		},
		output: productOutput(config.maxResultChars),
		async execute(args) {
			const plan = buildPocPlan({
				productName: args.productName,
				objective: args.objective,
				criticalRisks: pocRisksFromJson(args.risks),
				scope: arrayInput(args.scope, "scope"),
				nonGoals: arrayInput(args.nonGoals, "nonGoals"),
				method: args.method,
				duration: args.duration,
				owner: args.owner,
				decisionRule: args.decisionRule
			});
			return wrapResult(plan, { nextActions: plan.nextActions });
		}
	}));
	ctx.tools.register(defineTool({
		name: "product_mvp_plan",
		description: "Define the smallest observable and deliverable MVP after POC, including in-scope, out-of-scope, flow, acceptance criteria, instrumentation and success metrics.",
		parameters: {
			productName: {
				type: "string",
				required: true,
				description: "Product or slice name."
			},
			targetUser: {
				type: "string",
				required: true,
				description: "Target user for this MVP."
			},
			coreOutcome: {
				type: "string",
				required: true,
				description: "The single core outcome the MVP must deliver."
			},
			inScope: {
				type: "string",
				required: true,
				description: "JSON array or newline-separated MVP scope."
			},
			outOfScope: {
				type: "string",
				required: true,
				description: "JSON array or newline-separated non-goals."
			},
			userFlow: {
				type: "string",
				required: true,
				description: "JSON array or newline-separated flow steps."
			},
			acceptanceCriteria: {
				type: "string",
				required: true,
				description: "JSON array or newline-separated acceptance criteria."
			},
			successMetrics: {
				type: "string",
				required: true,
				description: "JSON array or newline-separated success metrics."
			},
			instrumentation: {
				type: "string",
				description: "JSON array or newline-separated events/fields to instrument."
			},
			dependencies: {
				type: "string",
				description: "JSON array or newline-separated dependencies."
			},
			risks: {
				type: "string",
				description: "JSON array or newline-separated delivery risks."
			},
			owner: {
				type: "string",
				description: "Product owner."
			},
			duration: {
				type: "string",
				required: true,
				description: "Expected delivery or beta preparation duration."
			},
			decisionRule: {
				type: "string",
				required: true,
				description: "Decision rule after MVP/Beta evidence."
			}
		},
		output: productOutput(config.maxResultChars),
		async execute(args) {
			const plan = buildMvpPlan({
				productName: args.productName,
				targetUser: args.targetUser,
				coreOutcome: args.coreOutcome,
				inScope: arrayInput(args.inScope, "inScope"),
				outOfScope: arrayInput(args.outOfScope, "outOfScope"),
				userFlow: arrayInput(args.userFlow, "userFlow"),
				acceptanceCriteria: arrayInput(args.acceptanceCriteria, "acceptanceCriteria"),
				successMetrics: arrayInput(args.successMetrics, "successMetrics"),
				instrumentation: arrayInput(args.instrumentation, "instrumentation"),
				dependencies: arrayInput(args.dependencies, "dependencies"),
				risks: arrayInput(args.risks, "risks"),
				owner: args.owner,
				duration: args.duration,
				decisionRule: args.decisionRule
			});
			return wrapResult(plan, { nextActions: plan.nextActions });
		}
	}));
	ctx.tools.register(defineTool({
		name: "product_prd",
		description: "Render a reviewable PRD Markdown document from a product_mvp_plan result. It does not create code or design files.",
		parameters: { mvpJson: {
			type: "string",
			required: true,
			description: "JSON returned by product_mvp_plan or its data object."
		} },
		output: productOutput(config.maxResultChars),
		async execute(args) {
			const prd = buildPrd(mvpFromJson(args.mvpJson));
			return wrapResult(prd, { nextActions: prd.nextActions });
		}
	}));
	ctx.tools.register(defineTool({
		name: "product_release_check",
		description: "Evaluate Beta/release readiness from explicit checks, evidence, owners and blockers. Returns release, conditional release or hold.",
		parameters: {
			productName: {
				type: "string",
				required: true,
				description: "Product name."
			},
			version: {
				type: "string",
				required: true,
				description: "Version or release candidate."
			},
			targetAudience: {
				type: "string",
				required: true,
				description: "Beta or launch audience."
			},
			checks: {
				type: "string",
				required: true,
				description: "JSON array of {name,status,evidence,owner,blocker}; status is pass, warning, blocker or not-checked."
			},
			owner: {
				type: "string",
				description: "Release owner."
			},
			launchDate: {
				type: "string",
				description: "Planned launch date."
			}
		},
		output: productOutput(config.maxResultChars),
		async execute(args) {
			const review = buildReleaseReview({
				productName: args.productName,
				version: args.version,
				targetAudience: args.targetAudience,
				checks: releaseChecks(args.checks),
				owner: args.owner,
				launchDate: args.launchDate
			});
			return wrapResult(review, { nextActions: review.nextActions });
		}
	}));
	ctx.tools.register(defineTool({
		name: "product_pmf_review",
		description: "Review PMF evidence from a local CSV, JSON or JSONL dataset. Separates value, usage, retention, commercial and referral signals by segment; never reduces PMF to a single score.",
		parameters: {
			sourcePath: {
				type: "string",
				required: true,
				description: "PMF, usage, retention or customer evidence dataset under defaultRoot."
			},
			productName: {
				type: "string",
				required: true,
				description: "Product name."
			},
			segmentField: {
				type: "string",
				description: "Segment/cohort field."
			},
			valueField: {
				type: "string",
				description: "Very disappointed, would miss or value signal field."
			},
			retentionField: {
				type: "string",
				description: "Retained or retention rate field."
			},
			paidField: {
				type: "string",
				description: "Paid, renewed, converted or deal field."
			},
			referralField: {
				type: "string",
				description: "Referred or recommendation field."
			},
			usageField: {
				type: "string",
				description: "Usage frequency, active days or sessions field."
			},
			minSample: {
				type: "number",
				description: "Reference minimum sample size; not an industry benchmark."
			}
		},
		output: productOutput(config.maxResultChars),
		async execute(args, exec) {
			await ensureInsideRoot(fs, config, args.sourcePath, exec.signal);
			const dataset = await readDataset(fs, config, args.sourcePath, exec.signal);
			const review = reviewPmfRows({
				productName: args.productName,
				source: args.sourcePath,
				rows: dataset.rows,
				segmentField: args.segmentField,
				valueField: args.valueField,
				retentionField: args.retentionField,
				paidField: args.paidField,
				referralField: args.referralField,
				usageField: args.usageField,
				minSample: args.minSample
			});
			review.warnings.push(...dataset.warnings);
			return wrapResult(review, {
				lineage: [{
					source: args.sourcePath,
					fields: review.evidenceSummary.fieldsDetected
				}],
				assumptions: review.assumptions,
				nextActions: review.nextActions
			});
		}
	}));
	ctx.tools.register(defineTool({
		name: "product_decision_review",
		description: "Evaluate whether a product should move forward, iterate, hold, abandon the current direction or scale investment. Uses explicit decision gates and does not infer a stop decision from missing evidence.",
		parameters: {
			productName: {
				type: "string",
				required: true,
				description: "Product or product slice name."
			},
			stage: {
				type: "string",
				required: true,
				description: "Current stage: handoff, strategy, poc, mvp, beta, pmf, iteration or growth-handoff."
			},
			gates: {
				type: "string",
				required: true,
				description: "JSON array of {id,label,status,evidence,threshold,blocking,owner}; status is pass, warning, fail or missing."
			},
			decisionDate: {
				type: "string",
				description: "Date on which this decision is made or should be revisited."
			},
			scaleReady: {
				type: "boolean",
				description: "Set true only when all gates pass and the evidence supports expanding investment."
			}
		},
		output: productOutput(config.maxResultChars),
		async execute(args) {
			const review = buildProductDecisionReview({
				productName: args.productName,
				stage: productStage(args.stage),
				gates: decisionGates(args.gates),
				decisionDate: args.decisionDate,
				scaleReady: args.scaleReady
			});
			return wrapResult(review, {
				nextActions: review.nextActions,
				assumptions: review.assumptions
			});
		}
	}));
	ctx.tools.register(defineTool({
		name: "product_sales_handoff",
		description: "Create a versioned product-to-sales handoff only after a proceed or scale product decision. Carries buyer problem, value evidence, proof points, delivery boundaries and commercial dependencies to dsh-sales; it does not set price or make a sales commitment.",
		parameters: {
			productName: {
				type: "string",
				required: true,
				description: "Product name."
			},
			productDecision: {
				type: "string",
				required: true,
				enum: ["proceed", "scale"],
				description: "Decision gate that permits a sales handoff."
			},
			targetBuyer: {
				type: "string",
				required: true,
				description: "Target buyer or economic buyer."
			},
			customerProblem: {
				type: "string",
				required: true,
				description: "Customer problem supported by product evidence."
			},
			desiredOutcome: {
				type: "string",
				required: true,
				description: "Observable customer outcome."
			},
			valueEvidence: {
				type: "string",
				required: true,
				description: "JSON array or newline-separated value evidence."
			},
			proofPoints: {
				type: "string",
				required: true,
				description: "JSON array or newline-separated proof points, customer statements or observed results."
			},
			requiredCapabilities: {
				type: "string",
				description: "JSON array or newline-separated capabilities the sales promise must include."
			},
			implementationConstraints: {
				type: "string",
				description: "JSON array or newline-separated delivery, integration, compliance or timeline constraints."
			},
			commercialContext: {
				type: "string",
				description: "JSON array or newline-separated approved commercial context, usually from dsh-business."
			},
			commercialQuestions: {
				type: "string",
				description: "JSON array or newline-separated commercial questions still requiring dsh-business or customer confirmation."
			},
			nextCustomerAction: {
				type: "string",
				required: true,
				description: "One observable next customer action with owner/date if known."
			},
			owner: {
				type: "string",
				description: "Handoff owner."
			},
			source: {
				type: "string",
				description: "Source product decision or PMF artifact path."
			}
		},
		output: productOutput(config.maxResultChars),
		async execute(args) {
			const handoff = buildProductSalesHandoff({
				productName: args.productName,
				productDecision: args.productDecision,
				targetBuyer: args.targetBuyer,
				customerProblem: args.customerProblem,
				desiredOutcome: args.desiredOutcome,
				valueEvidence: arrayInput(args.valueEvidence, "valueEvidence"),
				proofPoints: arrayInput(args.proofPoints, "proofPoints"),
				requiredCapabilities: arrayInput(args.requiredCapabilities, "requiredCapabilities"),
				implementationConstraints: arrayInput(args.implementationConstraints, "implementationConstraints"),
				commercialContext: arrayInput(args.commercialContext, "commercialContext"),
				commercialQuestions: arrayInput(args.commercialQuestions, "commercialQuestions"),
				nextCustomerAction: args.nextCustomerAction,
				owner: args.owner,
				source: args.source
			});
			return wrapResult(handoff, {
				lineage: args.source ? [{ source: args.source }] : [],
				nextActions: handoff.nextActions
			});
		}
	}));
	ctx.tools.register(defineTool({
		name: "product_growth_handoff",
		description: "Create a product-to-growth handoff with product outcome, evidence, primary metric, guardrails and open questions for dsh-growth. It does not perform acquisition or sales execution.",
		parameters: {
			productName: {
				type: "string",
				required: true,
				description: "Product name."
			},
			productOutcome: {
				type: "string",
				required: true,
				description: "Product result that is ready to be measured for growth."
			},
			evidence: {
				type: "string",
				description: "JSON array or newline-separated product evidence."
			},
			primaryMetric: {
				type: "string",
				required: true,
				description: "Primary growth metric."
			},
			guardrails: {
				type: "string",
				description: "JSON array or newline-separated guardrail metrics."
			},
			openQuestions: {
				type: "string",
				description: "JSON array or newline-separated unresolved questions."
			},
			recommendedActions: {
				type: "string",
				description: "JSON array or newline-separated recommended next actions."
			},
			pmfJson: {
				type: "string",
				description: "Optional product_pmf_review result; its evidence and decision are included as context."
			},
			owner: {
				type: "string",
				description: "Handoff owner."
			},
			source: {
				type: "string",
				description: "Source artifact path."
			}
		},
		output: productOutput(config.maxResultChars),
		async execute(args) {
			const pmf = args.pmfJson ? parseEnvelope(args.pmfJson) : void 0;
			const pmfEvidence = pmf && Array.isArray(pmf.signals) ? pmf.signals.map((signal) => typeof signal === "object" && signal !== null && "evidence" in signal ? String(signal.evidence) : "").filter(Boolean) : [];
			const handoff = buildGrowthHandoff({
				productName: args.productName,
				productOutcome: args.productOutcome,
				evidence: [...arrayInput(args.evidence, "evidence"), ...pmfEvidence],
				primaryMetric: args.primaryMetric,
				guardrails: arrayInput(args.guardrails, "guardrails"),
				openQuestions: arrayInput(args.openQuestions, "openQuestions"),
				recommendedActions: arrayInput(args.recommendedActions, "recommendedActions"),
				owner: args.owner,
				source: args.source
			});
			return wrapResult(handoff, {
				lineage: args.source ? [{ source: args.source }] : [],
				nextActions: handoff.nextActions
			});
		}
	}));
	ctx.tools.register(defineTool({
		name: "product_review",
		description: "Run the full local product-delivery review from handoff through growth handoff, optionally attaching a PMF evidence dataset.",
		parameters: {
			root: {
				type: "string",
				description: "Optional directory under defaultRoot."
			},
			pmfPath: {
				type: "string",
				description: "Optional local PMF/usage/retention dataset."
			},
			productName: {
				type: "string",
				description: "Product name when pmfPath is supplied."
			},
			segmentField: { type: "string" },
			valueField: { type: "string" },
			retentionField: { type: "string" },
			paidField: { type: "string" },
			referralField: { type: "string" },
			usageField: { type: "string" },
			minSample: { type: "number" },
			decisionJson: {
				type: "string",
				description: "Optional JSON returned by product_decision_review; its decision and evidence are included in the full review."
			}
		},
		output: productOutput(config.maxResultChars),
		async execute(args, exec) {
			const root = args.root?.trim() || config.defaultRoot;
			await ensureInsideRoot(fs, config, root, exec.signal);
			const onboarding = buildProductOnboarding({
				root,
				scan: await scanProductVault(fs, root, config, exec.signal)
			});
			let pmf;
			const decisionReview = args.decisionJson ? decisionReviewFromJson(args.decisionJson) : void 0;
			const lineage = [{ source: root }];
			if (args.pmfPath?.trim()) {
				await ensureInsideRoot(fs, config, args.pmfPath, exec.signal);
				const dataset = await readDataset(fs, config, args.pmfPath, exec.signal);
				pmf = reviewPmfRows({
					productName: args.productName?.trim() || "未命名产品",
					source: args.pmfPath,
					rows: dataset.rows,
					segmentField: args.segmentField,
					valueField: args.valueField,
					retentionField: args.retentionField,
					paidField: args.paidField,
					referralField: args.referralField,
					usageField: args.usageField,
					minSample: args.minSample
				});
				pmf.warnings.push(...dataset.warnings);
				lineage.push({
					source: args.pmfPath,
					fields: pmf.evidenceSummary.fieldsDetected
				});
			}
			const review = {
				generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
				root,
				onboarding,
				pmf,
				decisionReview,
				currentStep: decisionReview?.stage ?? (pmf?.status === "ready" ? "growth-handoff" : onboarding.sop.currentStep),
				decision: decisionReview?.decision ?? (pmf ? pmf.decision : onboarding.overallStatus === "ready" ? "进入 PMF 证据复盘或增长交接。" : "先完成当前阶段 gate."),
				warnings: [
					...onboarding.warnings,
					...pmf?.warnings ?? [],
					...decisionReview?.warnings ?? []
				],
				nextActions: decisionReview?.nextActions ?? pmf?.nextActions ?? onboarding.topActions
			};
			return wrapResult(review, {
				lineage,
				assumptions: [...pmf?.assumptions ?? [], ...decisionReview?.assumptions ?? []],
				nextActions: review.nextActions
			});
		}
	}));
	ctx.tools.register(defineTool({
		name: "product_report",
		description: "Render a product_review result into a shareable Markdown report. Reads the supplied JSON only and does not write files.",
		parameters: { reviewJson: {
			type: "string",
			required: true,
			description: "JSON returned by product_review."
		} },
		output: productOutput(config.maxResultChars),
		async execute(args) {
			const report = renderProductReport(reviewFromJson(args.reviewJson));
			return wrapResult(report, { nextActions: report.nextActions });
		}
	}));
	ctx.tools.register(defineTool({
		name: "product_apply",
		description: "Preview or apply a complete Markdown replacement under defaultRoot using a stale-version guard. Set confirm=true only after explicit approval.",
		parameters: {
			path: {
				type: "string",
				required: true,
				description: "Markdown product artifact to update."
			},
			content: {
				type: "string",
				required: true,
				description: "Complete replacement Markdown content."
			},
			confirm: {
				type: "boolean",
				required: true,
				description: "false previews only; true applies the guarded write."
			}
		},
		output: productOutput(config.maxResultChars),
		async execute(args, exec) {
			await ensureInsideRoot(fs, config, args.path, exec.signal);
			if (args.content.length > config.maxTextChars) throw new Error(`Replacement exceeds maxTextChars (${config.maxTextChars})`);
			const target = await fs.resolve(args.path, { signal: exec.signal });
			const info = await fs.stat(target, exec.signal);
			if (!info || info.type !== "file") throw new Error(`File not found: ${args.path}`);
			const current = await fs.readText(target, exec.signal);
			if (!args.confirm) {
				ctx.emit("product/report-previewed", {
					path: args.path,
					sourceCount: 1
				});
				return wrapResult({
					status: "preview-only",
					path: args.path,
					changed: args.content !== current,
					applied: false,
					title: parseNote(args.path, args.content).title,
					diff: replacementDiff(current, args.content)
				}, { nextActions: ["审阅 diff；明确确认后再以 confirm=true 写回。"] });
			}
			await fs.writeText(target, args.content, {
				kind: "replaceIfVersion",
				version: info.version
			}, exec.signal);
			ctx.emit("product/report-applied", { path: args.path });
			return wrapResult({
				status: "applied",
				path: args.path,
				changed: args.content !== current,
				applied: true,
				guarded: true
			}, { lineage: [{ source: args.path }] });
		}
	}));
	ctx.logger.info(`[dsh-product] registered product-delivery tools for ${config.defaultRoot}`);
}

//#endregion
//#region src/index.ts
const name = "dsh-product";
const inject = [
	"tools",
	"fs",
	"web"
];
const Config = Schema.object({
	defaultRoot: Schema.string().default("."),
	reportDir: Schema.string().default(".dsh-product/reports"),
	maxFiles: Schema.number().step(1).min(1).max(5e3).default(500),
	maxRows: Schema.number().step(1).min(1).max(5e5).default(1e5),
	maxFileBytes: Schema.number().step(1).min(1024).max(10485760).default(1048576),
	maxTextChars: Schema.number().step(1).min(1e3).max(1e6).default(18e4),
	maxResultChars: Schema.number().step(1).min(1e3).max(2e5).default(5e4),
	defaultLanguage: Schema.string().default("zh-CN"),
	defaultTimezone: Schema.string().default("Asia/Shanghai"),
	maxResearchQueries: Schema.number().step(1).min(1).max(10).default(5),
	maxResearchResults: Schema.number().step(1).min(1).max(20).default(5),
	maxResearchChars: Schema.number().step(1).min(1e3).max(1e5).default(3e4),
	requestTimeoutMs: Schema.number().step(1).min(1e3).max(12e4).default(3e4)
});
function apply(ctx, config) {
	const fs = ctx.fs;
	if (!ctx.registry.has(webFetchHttp)) ctx.plugin(webFetchHttp, {
		maxBodyChars: 1e5,
		maxResponseBytes: 5e6,
		timeoutMs: 3e4,
		maxRedirects: 5
	});
	const web = ctx.web;
	registerProductTools(ctx, config, fs, web);
	console.log(`[${name}] registered product-delivery tools with web research for ${config.defaultRoot}`);
}

//#endregion
export { Config, apply, inject, name };