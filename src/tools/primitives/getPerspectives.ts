import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface PerspectiveInfo {
  name: string;
  type: 'built-in' | 'custom';
  id?: string;
}

/**
 * AppleScriptを生成してパースペクティブ一覧を取得
 */
function generateGetPerspectivesScript(): string {
  return `
  try
    tell application "OmniFocus"
      tell front document
        -- 組み込みパースペクティブを取得
        set builtInPerspectives to {"Inbox", "Projects", "Tags", "Forecast", "Flagged", "Review"}
        
        -- カスタムパースペクティブを取得
        set customPerspectives to {}
        set customPerspectiveNames to name of every perspective
        
        -- 結果をJSON形式で構築
        set resultArray to {}
        
        -- 組み込みパースペクティブを追加
        repeat with perspectiveName in builtInPerspectives
          set end of resultArray to "{\\\"name\\\":\\\"" & perspectiveName & "\\\",\\\"type\\\":\\\"built-in\\\"}"
        end repeat
        
        -- カスタムパースペクティブを追加
        repeat with perspectiveName in customPerspectiveNames
          set end of resultArray to "{\\\"name\\\":\\\"" & perspectiveName & "\\\",\\\"type\\\":\\\"custom\\\"}"
        end repeat
        
        set AppleScript's text item delimiters to ","
        set resultString to "[" & (resultArray as string) & "]"
        set AppleScript's text item delimiters to ""
        
        return resultString
      end tell
    end tell
  on error errorMessage
    return "{\\\"error\\\":\\\"" & errorMessage & "\\\"}"
  end try
  `;
}

/**
 * OmniFocusで利用可能なパースペクティブ一覧を取得
 */
export async function getPerspectives(): Promise<{
  success: boolean,
  perspectives?: PerspectiveInfo[],
  error?: string
}> {
  try {
    const script = generateGetPerspectivesScript();
    
    console.error("Executing AppleScript to get perspectives...");
    
    const { stdout, stderr } = await execAsync(`osascript -e '${script}'`);
    
    if (stderr) {
      console.error("AppleScript stderr:", stderr);
    }
    
    console.error("AppleScript stdout:", stdout);
    
    try {
      const result = JSON.parse(stdout);
      
      if (result.error) {
        return {
          success: false,
          error: result.error
        };
      }
      
      return {
        success: true,
        perspectives: result
      };
    } catch (parseError) {
      console.error("Error parsing AppleScript result:", parseError);
      return {
        success: false,
        error: `Failed to parse result: ${stdout}`
      };
    }
  } catch (error: any) {
    console.error("Error in getPerspectives execution:", error);
    return {
      success: false,
      error: error?.message || "Unknown error in getPerspectives"
    };
  }
} 