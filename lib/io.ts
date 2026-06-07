import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";

const FILE_NAME = "squadron-duty-backup.json";

/**
 * Export the given JSON string to a shareable file (or download on web).
 *
 * @param json     The serialized app state.
 * @param fileName Desired file name (e.g. "NO.8 SQDN backup 7-6-2026.json").
 *                 Falls back to a generic name when omitted.
 */
export async function exportToFile(
  json: string,
  fileName: string = FILE_NAME,
): Promise<void> {
  if (Platform.OS === "web") {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return;
  }

  const uri = (FileSystem.documentDirectory ?? "") + fileName;
  await FileSystem.writeAsStringAsync(uri, json);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      mimeType: "application/json",
      dialogTitle: "Squadron Duty backup",
      UTI: "public.json",
    });
  }
}

/**
 * Export a roster sheet. On web it opens a print-ready window (the browser's
 * own "Save as PDF" handles the conversion). On native it renders the HTML to a
 * real PDF via expo-print and opens the share sheet (expo-sharing).
 *
 * @param html     The roster HTML (from buildRosterHtml).
 * @param fileName Desired file name; the extension is normalised per platform
 *                 (.html for the web download fallback, .pdf on native).
 */
export async function exportRosterSheet(
  html: string,
  fileName: string,
): Promise<void> {
  if (Platform.OS === "web") {
    const win = window.open("", "_blank");
    if (win) {
      win.document.open();
      win.document.write(html);
      win.document.close();
      win.focus();
      setTimeout(() => {
        try {
          win.print();
        } catch {
          /* user can still print manually */
        }
      }, 350);
      return;
    }
    // Popup blocked — fall back to downloading the HTML file.
    const htmlName = fileName.replace(/\.[^.]+$/, "") + ".html";
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = htmlName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return;
  }

  // Native: render the HTML to a real PDF, then share it.
  const { uri } = await Print.printToFileAsync({ html });

  // Give the shared file a friendly name (printToFileAsync uses a random name).
  const pdfName = fileName.replace(/\.[^.]+$/, "") + ".pdf";
  let shareUri = uri;
  const dir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
  if (dir) {
    const target = dir + pdfName;
    try {
      await FileSystem.deleteAsync(target, { idempotent: true });
      await FileSystem.moveAsync({ from: uri, to: target });
      shareUri = target;
    } catch {
      /* fall back to the generated uri if the rename fails */
    }
  }

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(shareUri, {
      mimeType: "application/pdf",
      dialogTitle: "Squadron Duty roster",
      UTI: "com.adobe.pdf",
    });
  }
}

/** Let the user pick a JSON file and return its contents (or null if cancelled). */
export async function importFromFile(): Promise<string | null> {
  if (Platform.OS === "web") {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "application/json,.json";
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) {
          resolve(null);
          return;
        }
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => resolve(null);
        reader.readAsText(file);
      };
      input.click();
    });
  }

  const res = await DocumentPicker.getDocumentAsync({
    type: ["application/json", "text/plain"],
    copyToCacheDirectory: true,
  });
  if (res.canceled || !res.assets?.[0]) return null;
  return await FileSystem.readAsStringAsync(res.assets[0].uri);
}
