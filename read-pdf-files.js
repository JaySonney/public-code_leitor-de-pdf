import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { execSync } from "child_process";
import Tesseract from "tesseract.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Pasta correta dos PDFs
const folder = path.join(__dirname, "pdfs", "fase_3");
const files = fs
  .readdirSync(folder)
  .filter((f) => f.toLowerCase().endsWith(".pdf"));

// ------------------- Funções utilitárias -------------------
function extrairLinksDoTexto(text) {
  const regex = /https?:\/\/[^\s)]+/gi;
  return text.match(regex) || [];
}

// Agrupa palavras do PDF em linhas baseado na posição vertical (Y)
function agruparLinhas(items) {
  const linesMap = {};
  items.forEach((item) => {
    const y = Math.round(item.transform[5]); // posição vertical aproximada
    if (!linesMap[y]) linesMap[y] = [];
    linesMap[y].push(item.str);
  });

  // ordenar do topo para baixo (maior Y → menor Y)
  const sortedY = Object.keys(linesMap)
    .map(Number)
    .sort((a, b) => b - a);

  const lines = sortedY.map((y) => linesMap[y].join(" ").trim());
  return lines;
}

// ------------------- Processamento de uma página -------------------
async function processarPagina(page, pageNum, filePath) {
  let lines = [];
  let links = [];

  // --- TEXTO embutido ---
  const textContent = await page.getTextContent();
  if (textContent.items.length > 0) {
    lines = agruparLinhas(textContent.items);
  }

  // --- LINKS ---
  const annotations = await page.getAnnotations();
  const annotationLinks = annotations
    .filter((a) => a.subtype === "Link" && a.url)
    .map((a) => a.url);

  links = [...annotationLinks, ...extrairLinksDoTexto(lines.join(" "))];

  // --- OCR se não houver texto ---
  if (lines.length === 0) {
    const tempImagePrefix = `./temp_page`;
    execSync(
      `pdftoppm -f ${pageNum} -l ${pageNum} -png "${filePath}" "${tempImagePrefix}"`
    );

    const imagePath = `temp_page-${pageNum}.png`;
    if (fs.existsSync(imagePath)) {
      const { data } = await Tesseract.recognize(imagePath, "por", {
        tessjs_create_hocr: "1",
      });

      if (data.lines && Array.isArray(data.lines) && data.lines.length > 0) {
        lines = data.lines.map((l) => l.text.trim()).filter(Boolean);
      } else if (data.text) {
        lines = data.text
          .split("\n")
          .map((t) => t.trim())
          .filter(Boolean);
      } else {
        lines = [];
      }

      fs.unlinkSync(imagePath);
    }
  }

  return { page: pageNum, lines, links };
}

// ------------------- Processamento de um PDF -------------------
async function processarPDF(filePath) {
  const dataBuffer = new Uint8Array(fs.readFileSync(filePath));
  const pdfDoc = await pdfjsLib.getDocument({ data: dataBuffer }).promise;

  const pages = [];
  for (let i = 1; i <= pdfDoc.numPages; i++) {
    const page = await pdfDoc.getPage(i);
    const processedPage = await processarPagina(page, i, filePath);
    pages.push(processedPage);
  }

  return { file: path.basename(filePath), pages };
}

// ------------------- Processamento de todos os PDFs -------------------
async function processarTodos() {
  const exitDir = path.join(__dirname, "exit");

  if (!fs.existsSync(exitDir)) fs.mkdirSync(exitDir);

  for (const file of files) {
    const filePath = path.join(folder, file);
    console.log("📄 Lendo:", filePath);

    try {
      const result = await processarPDF(filePath);
      const outPath = path.join(exitDir, file.replace(".pdf", ".json"));
      fs.writeFileSync(outPath, JSON.stringify(result, null, 2), "utf8");
      console.log("✅ Resultado salvo em:", outPath);
    } catch (err) {
      console.error("❌ Erro processando", file, err);
    }
  }
}

// ------------------- Execução -------------------
processarTodos();
