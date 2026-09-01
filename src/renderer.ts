import clientScript from "tandem:client";
import styles from "tandem:styles";
import htmlTemplate from "./renderer/index.html";

const STYLES_TOKEN = "__TANDEM_STYLES__";
const CLIENT_TOKEN = "__TANDEM_CLIENT__";

function injectAsset(template: string, token: string, content: string): string {
    if (!template.includes(token)) {
        throw new Error(`Tandem renderer template is missing ${token}.`);
    }
    return template.replace(token, content);
}

export function renderTandemHtml(): string {
    const withStyles = injectAsset(htmlTemplate, STYLES_TOKEN, styles);
    return injectAsset(withStyles, CLIENT_TOKEN, clientScript);
}
