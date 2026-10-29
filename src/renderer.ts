import clientScript from "tandem:client";
import styles from "tandem:styles";
import htmlTemplate from "./renderer/index.html";
import { readBrowserDevelopmentAssets } from "./browser/development-assets.js";

const STYLES_TOKEN = "__TANDEM_STYLES__";
const CLIENT_TOKEN = "__TANDEM_CLIENT__";
const VERSION_TOKEN = "__TANDEM_VERSION__";

function injectAsset(template: string, token: string, content: string): string {
    if (!template.includes(token)) {
        throw new Error(`Tandem renderer template is missing ${token}.`);
    }
    return template.replace(token, () => content);
}

export function renderTandemHtml(version: string): string {
    const development = readBrowserDevelopmentAssets()?.renderer;
    const withStyles = injectAsset(development?.template ?? htmlTemplate, STYLES_TOKEN, development?.styles ?? styles);
    const withClient = injectAsset(withStyles, CLIENT_TOKEN, (development?.script ?? clientScript).replace(/<\/script/gi, "<\\/script"));
    return injectAsset(withClient, VERSION_TOKEN, version);
}
