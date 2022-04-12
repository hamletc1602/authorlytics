/**
 * Creates a menu entry in the Google Docs UI when the document is opened.
 *
 * @param {object} e The event parameter for a simple onOpen trigger. To
 *     determine which authorization mode (ScriptApp.AuthMode) the trigger is
 *     running in, inspect e.authMode.
 */
function onOpen(e) {
    DocumentApp.getUi().createAddonMenu()
        .addItem('Start', 'showSidebar')
        .addToUi();
}

/**
 * Runs when the add-on is installed.
 *
 * @param {object} e The event parameter for a simple onInstall trigger. To
 *     determine which authorization mode (ScriptApp.AuthMode) the trigger is
 *     running in, inspect e.authMode. (In practice, onInstall triggers always
 *     run in AuthMode.FULL, but onOpen triggers may be AuthMode.LIMITED or
 *     AuthMode.NONE.)
 */
function onInstall(e) {
    onOpen(e);
}

/**
 * Opens a sidebar in the document containing the add-on's user interface.
 */
function showSidebar() {
    var ui = HtmlService.createHtmlOutputFromFile('Sidebar')
        .setTitle('Authorlyze')
        .setSandboxMode(HtmlService.SandboxMode.IFRAME);
    DocumentApp.getUi().showSidebar(ui);
}

/**
  Handler for Analyze button.
*/
function runAnalyze() {
  var textDoc = getTextDoc();
  Logger.log("Source Text: %s", JSON.stringify(textDoc));
  var problems = analyze(textDoc);
  //var problems = mockAnalyze(textDoc);
  Logger.log("Problems: %s", JSON.stringify(problems));
  markupDoc(problems);
}

/**
  Handler for Clear button.
*/
function clearAnalyze() {
  var body = DocumentApp.getActiveDocument().getBody(),
      paras = body.getParagraphs(),
      para, text;
    
  paras.forEach(function(para) {
    text = para.editAsText();
    if (text && text.getText().length > 0) {
      text.setForegroundColor(0, text.getText().length - 1, '#000000');
      text.setBackgroundColor(0, text.getText().length - 1, '#FFFFFF');
    }
  });
}

/**
 * Get the text from the current selection, or all text in the document.
 *
 * @return {Array.{text:<string>}} The document/selected text.
 */
function getTextDoc() {
  var body = DocumentApp.getActiveDocument().getBody(),
      selection = DocumentApp.getActiveDocument().getSelection(),
      ranges, paras = [], text = [], startOffset = 0;
  
  if (selection) {
    ranges = selection.getSelectedElements();
    ranges.forEach(function(range) {
      if (range.getElement().getType() == DocumentApp.ElementType.PARAGRAPH) {
        paras.push(range.getElement());
      }
    });
  } else {
    paras = body.getParagraphs();
  }
    
  if (paras) {
    var text = [];
    for (var i = 0; i < paras.length; i++) {
      var para = paras[i];
      // Only use elements that can be edited as text; skip images and
      // other non-text elements.
      if (para.editAsText) {
        var paraText = para.asText().getText();
        // This check is necessary to exclude images, which return a blank
        // text element.
        if (paraText != '') {
          // Get the index for this paragraph within the document body. This will be 
          // used to locate the appropriate paragraph when formatting.
          text.push({ index: body.getChildIndex(para), text: paraText });
        }
      }
    }
  } else {
    throw 'Empty document?';
  }
  
  // Return the document object   
  return { startOffset: startOffset, document: text };
}

/**
  Send the given document text to the analysis sevice and return the resulting problems.
*/
function analyze(textDoc) {
  var response, respData;
  
  // Post document text to Analysis service
  try {
    response = UrlFetchApp.fetch("http://authorlytics-brae.rhcloud.com/analyze", { 
      contentType: "application/json", 
      method: "post", 
      payload: JSON.stringify(textDoc)
    });
  } catch (e) {
    throw ("Analysis request failed: " + e);
  }
  
  // Return response
  try {
    respData = response.getContentText();
    return JSON.parse(respData);
  } catch (e) {
    throw ("Invalid Analysis response: " + e);
  }
}

/**
  Update the document using the analysis response.
*/
function markupDoc(problems) {
  var body = DocumentApp.getActiveDocument().getBody(),
      paras = body.getParagraphs(),
      para, text, color;
    
  problems.forEach(function(problem) {
    para = paras[problem.paraIndex];
    text = para.editAsText();
    color = getSeverityColor(problem.severity);
    if (useForegroundColor(problem.type)) {
        text.setForegroundColor(problem.start, problem.end, color);
    } else {
        text.setBackgroundColor(problem.start, problem.end, color);
    }
  });
}

/**
  Return a color code for the given severity name
  TODO: Make this a preference
*/
function getSeverityColor(severity) {
  switch (severity) {
    case 'info': return '#6fa7da';
    case 'review': return '#fdd766';
    case 'warn': return '#f4b16b';
    case 'error': return '#de6666';
    default: return '#000000';
  }
}

/**
  Return foreground or background flag based on the problem type.
  TODO: Make this a preference
*/
function useForegroundColor(problemType) {
  if ("sentenceLengths" == problemType) {
    return false;
  }
  return true;
}

/**
 * Gets the stored user preferences for the origin and destination languages,
 * if they exist.
 *
 * @return {Object} The user's origin and destination language preferences, if
 *     they exist.
 */
function getPreferences() {
    var userProperties = PropertiesService.getUserProperties();
    var languagePrefs = {
        analysisServiceUrl: userProperties.getProperty('analysisServiceUrl')
    };
    return languagePrefs;
}

/**
  Mock Alanysis response to test formatting.
*/
function mockAnalyze(textDoc) {
  return [
    {
        "type": "sentenceLengths",
        "paraIndex": [
            4
        ],
        "severity": "warn",
        "start": 0,
        "end": 71
    },
    {
        "type": "weakWord",
        "word": "Then",
        "severity": "review",
        "paraIndex": 1,
        "start": 23,
        "end": 27
    },
    {
        "type": "weakWord",
        "word": "that",
        "severity": "review",
        "paraIndex": 3,
        "start": 25,
        "end": 29
    },
    {
        "type": "weakWord",
        "word": "that",
        "severity": "review",
        "paraIndex": 3,
        "start": 53,
        "end": 57
    },
    {
        "type": "weakWord",
        "word": "feel",
        "severity": "review",
        "paraIndex": 3,
        "start": 67,
        "end": 71
    },
    {
        "type": "weakWord",
        "word": "feel",
        "severity": "review",
        "paraIndex": 3,
        "start": 79,
        "end": 83
    },
    {
        "type": "weakWord",
        "word": "like",
        "severity": "review",
        "paraIndex": 3,
        "start": 72,
        "end": 76
    },
    {
        "type": "firstWordDup",
        "paraIndex": 2,
        "severity": "warn",
        "start": 0,
        "end": 4
    },
    {
        "type": "firstLetterDup",
        "paraIndex": 2,
        "severity": "review",
        "start": 0,
        "end": 1
    },
    {
        "type": "firstWordDup",
        "paraIndex": 3,
        "severity": "error",
        "start": 0,
        "end": 4
    },
    {
        "type": "firstLetterDup",
        "paraIndex": 3,
        "severity": "warn",
        "start": 0,
        "end": 1
    }
];
}
