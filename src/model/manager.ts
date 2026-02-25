import {
  getCurrentModel,
  getScopedModel,
  setCurrentModel,
  setScopedModel,
} from "../settings/manager.js";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import type { ModelInfo, FavoriteModel } from "./types.js";
import path from "node:path";

interface OpenCodeModelState {
  favorite?: Array<{ providerID?: string; modelID?: string }>;
}

export function getModelScopeKey(chatId: number | null, threadId: number | null): string {
  return `${chatId ?? "none"}:${threadId ?? "private"}`;
}

function getEnvDefaultModel(): FavoriteModel | null {
  const providerID = config.opencode.model.provider;
  const modelID = config.opencode.model.modelId;

  if (!providerID || !modelID) {
    return null;
  }

  return { providerID, modelID };
}

function dedupeModels(models: FavoriteModel[]): FavoriteModel[] {
  const unique = new Map<string, FavoriteModel>();

  for (const model of models) {
    const key = `${model.providerID}/${model.modelID}`;
    if (!unique.has(key)) {
      unique.set(key, model);
    }
  }

  return Array.from(unique.values());
}

function normalizeFavoriteModels(state: OpenCodeModelState): FavoriteModel[] {
  if (!Array.isArray(state.favorite)) {
    return [];
  }

  return state.favorite
    .filter(
      (model): model is { providerID: string; modelID: string } =>
        typeof model?.providerID === "string" &&
        model.providerID.length > 0 &&
        typeof model.modelID === "string" &&
        model.modelID.length > 0,
    )
    .map((model) => ({
      providerID: model.providerID,
      modelID: model.modelID,
    }));
}

function getOpenCodeModelStatePath(): string {
  const xdgStateHome = process.env.XDG_STATE_HOME;

  if (xdgStateHome && xdgStateHome.trim().length > 0) {
    return path.join(xdgStateHome, "opencode", "model.json");
  }

  const homeDir = process.env.HOME || process.env.USERPROFILE || "";
  return path.join(homeDir, ".local", "state", "opencode", "model.json");
}

/**
 * Get list of favorite models from OpenCode local state file
 * Falls back to env default model if file is unavailable or empty
 */
export async function getFavoriteModels(): Promise<FavoriteModel[]> {
  const envDefaultModel = getEnvDefaultModel();

  try {
    const fs = await import("fs/promises");

    const stateFilePath = getOpenCodeModelStatePath();
    const content = await fs.readFile(stateFilePath, "utf-8");
    const state = JSON.parse(content) as OpenCodeModelState;
    const favorites = normalizeFavoriteModels(state);

    if (favorites.length === 0) {
      if (envDefaultModel) {
        logger.info(`[ModelManager] No favorites in ${stateFilePath}, using env default model`);
        return [envDefaultModel];
      }

      logger.warn(`[ModelManager] No favorites in ${stateFilePath}`);
      return [];
    }

    const merged = envDefaultModel ? dedupeModels([...favorites, envDefaultModel]) : favorites;

    logger.debug(`[ModelManager] Loaded ${merged.length} favorite models from ${stateFilePath}`);
    return merged;
  } catch (err) {
    if (envDefaultModel) {
      logger.warn(
        "[ModelManager] Failed to load OpenCode favorites, using env default model:",
        err,
      );
      return [envDefaultModel];
    }

    logger.error("[ModelManager] Failed to load OpenCode favorites:", err);
    return [];
  }
}

/**
 * Get current model from settings or fallback to config
 * @returns Current model info
 */
export function fetchCurrentModel(): ModelInfo {
  return getStoredModel();
}

export function fetchCurrentModelForScope(
  threadId: number | null,
  chatId: number | null,
): ModelInfo {
  return getStoredModel(threadId, chatId);
}

/**
 * Select model and persist to settings
 * @param modelInfo Model to select
 */
export function selectModel(modelInfo: ModelInfo): void {
  logger.info(`[ModelManager] Selected model: ${modelInfo.providerID}/${modelInfo.modelID}`);
  setCurrentModel(modelInfo);
}

export function selectModelForScope(
  modelInfo: ModelInfo,
  threadId: number | null,
  chatId: number | null,
): void {
  const scopeKey = getModelScopeKey(chatId, threadId);
  logger.info(
    `[ModelManager] >>> SELECTING scoped model for ${scopeKey}: ${modelInfo.providerID}/${modelInfo.modelID}`,
  );

  setScopedModel(scopeKey, modelInfo);
  setCurrentModel(modelInfo);
}

/**
 * Get stored model from settings (synchronous)
 * ALWAYS returns a model - fallback to config if not found
 * @returns Current model info
 */
export function getStoredModel(threadId: number | null = null, chatId: number | null = null): ModelInfo {
  const scopeKey = getModelScopeKey(chatId, threadId);
  const scopedModel = getScopedModel(scopeKey);
  if (scopedModel) {
    logger.debug(`[ModelManager] Found scoped model for ${scopeKey}: ${scopedModel.providerID}/${scopedModel.modelID}`);
    if (!scopedModel.variant) {
      scopedModel.variant = "default";
    }
    return scopedModel;
  }

  logger.debug(`[ModelManager] No scoped model for ${scopeKey}, using global/fallback`);
  const storedModel = getCurrentModel();

  if (storedModel) {
    // Ensure variant is set (default to "default")
    if (!storedModel.variant) {
      storedModel.variant = "default";
    }
    return storedModel;
  }

  // Fallback to model from config (environment variables)
  if (config.opencode.model.provider && config.opencode.model.modelId) {
    logger.debug("[ModelManager] Using model from config");
    return {
      providerID: config.opencode.model.provider,
      modelID: config.opencode.model.modelId,
      variant: "default",
    };
  }

  // This should not happen if config is properly set
  logger.warn("[ModelManager] No model found in settings or config, returning empty model");
  return {
    providerID: "",
    modelID: "",
    variant: "default",
  };
}
