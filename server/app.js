'use strict';

var express = require('express');
var bodyParser = require('body-parser')
var fs = require('fs');
var csv = require('csv-parse');
var WordNet = require('node-wordnet');
var LRU = require("lru-cache");
var cheerio = require('cheerio');

var app = express();
app.use(bodyParser.json());

// Load Gishwhes
function loadGishwhesData() {
  var tagwords = ['poke', 'time-lapse', 'during the hunt', 'photoshop', 'child'];
  var tagStrings = ['pokemon', 'timelapse', 'delayed', 'photoshop', 'child'];
  var htmlString = fs.readFileSync("Items__GISHWHES.html").toString()
  var gishwhes = cheerio.load(htmlString, { decodeEntities: false })
  var items = gishwhes('div.item-row').toArray();
  var itemData = [];

  var items = gishwhes('div.item-row').map(function(i, item) {
    var number = cheerio(item).find('.item-number').text().trim();
    var points = cheerio(item).find('.item-points').text().trim();
    var desc = cheerio(item).find('.item-description').text().trim();
    var descLower = desc.toLowerCase();
    var statusImg = cheerio(item).find('.item-status').attr('src');
    var tags = [];
    var type = "";

    // Use the PNG image name for the status
    var typeMatch  = /_files\/(.*).png/.exec(statusImg);
    if (typeMatch) {
      type = typeMatch[1];
      if (type == 'video-image') {
        type = 'video';
      }
    }

    tagwords.forEach(function(tagword, index) {
      if (descLower.indexOf(tagword) > -1) {
        tags.push(tagStrings[index]);
      }
    });

    number = number.replace('#','');
    points = points.replace('POINTS','').trim();
    
    var data = {
      number: number,
      points: points,
      type: type,
      tags: tags,
      desc: desc
    }
    
    return data;
  });

  return items.toArray();
}

var gishwhesData = loadGishwhesData();


var fillerWordsList = [];
loadWordList("en-US-common-words.csv", fillerWordsList,
  function(rec) {
    return rec[1].trim();
  },
  function(rec) {
    var type = rec[2].trim();
    if (type === 'p' || type === 'a') {
      return true;
    }
    return false;
  });

var weakWordsList = [];
loadWordList("en-US-weak-words.csv", weakWordsList,
  function(rec) {
    return rec[0].trim();
  });

// Object containing cached problems data for each document.
var problemsCache = LRU(200);

// Utility functions wrapper
var util = {};

var wordNet = new WordNet({ cache: {} });

//
app.get('/', function (req, res) {

  // Debug: Show words list content
  console.log("Read " + weakWordsList.length + " weak words.");
  console.log("Read " + fillerWordsList.length + " filler words.");

  res.send("OK");
});

// Get a chached problem set
app.get('/gishwhes/:sort/:option', function(req, res) {
  var sort = req.params.sort;
  var option = req.params.option
  var localData = gishwhesData.slice(0);
  var descending = false;
  var response = "";

  if (option) {
    option = option.toLowerCase();
    if (option == 'desc') {
      descending = true;
    }
  }

  if (sort) {
    sort = sort.toLowerCase();

    if (sort == 'bypoints') {
      localData.sort(function(a, b) {
        if (descending) {
          return b.points - a.points;
        }
        return a.points - b.points;
      });
    }

  }

  response += '<!doctype html><html><body>';
  response += '<table border="1" cellspacing="0" cellpadding="5">';
  response += '<tr><th>#</th><th>Type</th><th>Points</th><th>Tags</th><th>Description</th></tr>';

  localData.forEach(function(item) {
    if (item.number == 22 || item.number == 38 || item.number == 53 || item.number == 71) {
      // Nothing
    } else {
      response += 
        '<tr class=item"><td class="number">' + item.number + '</td>' +
        '<td class="type">' + item.type + '</td>' + 
        '<td class="points">' + item.points + '</td>' + 
        '<td class="tags">' + item.tags.join(', ') + '</td>' + 
        '<td class="desc">' + item.desc + '</td></tr>';
    }
  });

  response += "</table>";
  response += '</body></html>';

  res.send(response);
});


// Get a chached problem set
app.get('/cache/problems/:docId', function(req, res) {
  res.json(problemsCache.get(req.params.docId));
});

// Put a chached problem set
app.post('/cache/problems/:docId', function(req, res) {
  console.log("Added doc " + req.params.docId + " to cache.");
  problemsCache.set(req.params.docId, req.body);
  res.json({ success: true });
});

//
app.post('/analyze', function(req, res) {
  var doc = req.body.document, textData,
    state = { paragraphs: [], sentences: [], words: {}, unknownWords: [] }, 
    problems, i;

  // Generate metadata from the raw document text
  if (doc) {
    doc.forEach(function(para) {
      textData = parseText(para.text);
      generateMetadata(state, para.index, textData);
    });
  } else {
    console.error("Missing document in input: " + JSON.stringify(req.body));
  }

  // Analyze the document metadata looking for problems.
  var problems = [], maxSentenceVariance = 5, maxSentenceRun = 4;
  util.checkSentenceLengths(state, problems, maxSentenceVariance, maxSentenceRun);
  util.checkWeakWords(state, problems);
  util.checkParaFirstWords(state, problems);

  res.json(problems);
});

/* Replace all smart quotes with regular quotes to make processing easier */
function replaceSmartQuotes(text) {
    text = text.replaceAll( "[\u2018\u2019\u201A\u201B\u2032\u2035]", "'" );
    text = text.replaceAll("[\u201C\u201D\u201E\u201F\u2033\u2036]","\"");
    return text;
}

function isDoubleQuote(char) {
  return /[\u201C\u201D\u201E\u201F\u2033\u2036]/.test(char);
}

/** Convert a block of raw imput text into a structured object with offsets for all sentences and words */
function parseText(text) {
  // Sentences assumed to end in "\.[\w\s]?"
  // Words assumed to be separated by [\w\s]?

  var sentences = [], state = {}, currWord = "",
      i, char, sawPeriod = false, inWord = false,
      periodIndex, sentenceStart = 0, wordStart = 0;

  state.currWords = [];
  state.addWord = function(text, start) {
      text = text.toLowerCase();
      var match = /'(.*)'/.exec(text);
      if (match) {
        text = match[1];
      }
      this.currWords.push({ start: start, text: text });
      if (text.length == 0) {
        console.log("Empty text: " + JSON.stringify(this.currWords));
      }
  }

  for (i=0; i < text.length; i+=1) {
    char = text[i];
    // Check for whitespace and double-quote characters 
    // (For now, easiest to consider quotes to be whitespace. Later we will 
    // likely want to mark whether words are inside or outside of dialog, since 
    // the 'weak words' rules are different.)
    if (/[\s"\u201C\u201D\u201E\u201F\u2033\u2036]/.test(char)) {
      if (sawPeriod) {
        inWord = false;
      } else if (currWord.length > 0) {
        // Store the last word and start a new one
        state.addWord(currWord, wordStart);
        currWord = "";
        wordStart = i;
      }
    } else {
      if (inWord) {
        if (/[\.\?!]/.test(char)) {
          // Period
          sawPeriod = true;
          periodIndex = i;
        } else {
          currWord += char;
        }
      } else {
        if ((currWord.length > 0)) {
          // Store the last word and start a new one
          state.addWord(currWord, wordStart);
          currWord = "";
          wordStart = i;
          if (sawPeriod) {
            // This was a sentence break
            sentences.push({ start: sentenceStart, length: (periodIndex - sentenceStart), words: state.currWords });
            state.currWords = [];
            sentenceStart = i;
            sawPeriod = false;
          }
        }
        currWord += char;
        inWord = true;
      }
    }
  }

  //
  var endIndex = text.length;
  //if (sawPeriod) {
  //  endIndex = text.length - 1;
  //}
  state.addWord(currWord, wordStart);
  sentences.push({ start: sentenceStart, length: (endIndex - sentenceStart), words: state.currWords });
  return sentences;
}

/** First pass: Process all the text elements into metadata: weak words, sentence lengths, etc.  */
function generateMetadata(state, paraIndex, textData) {
  /* state - 
    words:
        A map of all non-trivial words in the document, each entry containing an array of indexes
        where that word is found.
    Sentences:
        Each sentence has a start pos, length and the first word. 
    paragraphs: 
        Each paragraph contains the start pos, the first word.
  */
  //console.log("Analize: " + paraIndex + ": " + JSON.stringify(textData));

  textData.forEach(function(sentenceData) {
    //console.log("Words: " + JSON.stringify(state.words));

    sentenceData.words.forEach(function(wordData) {
      // Add index to this word's list
      if (state.words[wordData.text]) {
        state.words[wordData.text].push([paraIndex, wordData.start]);
      } else {
        // Ignore this word if it's on the filler-words list
        if ( ! fillerWordsList.find(function(item) {
            return item === wordData.text;
        })) {
          // Lookup lemma
          wordNet.lookup(wordData.text, function(error, result) {
            var lemma;
            if (error) {
              // Not found in database Add the raw word
              lemma = wordData.text;
              console.log("Unknown word: " + wordData.text);
              state.unknownWords.push(lemma);
            } else {
              //console.log("Word Lookup result for: " + wordData.text + ": " + JSON.stringify(result, null, 4));
              //console.log("Word Lookup lemma for: " + wordData.text + ": " + result.lemma);
              if (result.length > 0) {
                if (result[0].lemma) {
                  lemma = result[0].lemma;
                  //console.log("Found word: " + wordData.text + " Lemma: " + lemma);
                }
              }
              if ( ! lemma) {
                lemma = wordData.text;
                //console.log("Empty result for word: " + wordData.text);
              }
            }
            // Add word lemma
            state.words[lemma] = [[paraIndex, wordData.start]];
          });
        }
      }
    });

    state.sentences.push({
      para: paraIndex,
      start: sentenceData.start,
      length: sentenceData.length,
      firstWord: sentenceData.words[0].text
    });
  });

  state.paragraphs.push({
    index: paraIndex,
    firstWord: textData[0].words[0].text
  });

}

/**
*/
util.checkSentenceLengths = function(state, problems, maxVariance, maxRun) {
  var i, paraIndex, len, len1, sentence, diff, runCount = 1,
    group = [], groups = [];

  //console.log("Sentences: " + JSON.stringify(state.sentences));

  for (i=1; i < state.sentences.length; i+=1) {
    sentence = state.sentences[i];

    // Get len diff between this and previous sentence
    len = state.sentences[i-1].length;
    len1 = sentence.length;
    diff = Math.abs(len1 - len);
    sentence.lenDiff = diff;

    // Add this sentence to group if diff is too low.
    if (diff < maxVariance) {
      //console.log("Sentence: " + state.sentences[i-1].firstWord + "...(" + state.sentences[i-1].length + ") run #" + runCount);
      group.push(state.sentences[i-1]);
      runCount += 1;
    } else {
      if (runCount >= maxRun) {
        // Save any significant runs of the same size.
        //console.log("Found run of " + maxRun + " sentences of simillar lengths.");
        // Push the last sentence of the group.
        group.push(state.sentences[i-1]);
        groups.push(group);
      }
      group = [];
      runCount = 1;
    }
  } // Sentences

  // Convert run-groups into problems
  groups.forEach(function(group) {
    var paras = [], lastParaIndex;
    group.forEach(function(sentence) {
      if ( ! lastParaIndex || lastParaIndex !== sentence.para) {
        paras.push(sentence.para);
      }
      lastParaIndex = sentence.para;
    });
    var lastSentence = group[group.length - 1];

    problems.push({
      type: 'sentenceLengths',
      // Array for para index since these groups can span multiple paragraphs.
      paraIndex: paras,
      severity: 'warn',
      start: group[0].start,
      end: lastSentence.start + lastSentence.length
    });
  });
}

/**
  Check for paragraphs that start with the same letter or word.
*/
util.checkParaFirstWords = function(state, problems) {
  var lastPara, sameLetterCount = 0, sameWordCount = 0,
      lastFirstChar, firstChar;

  // Check the first word of each paragraph against the 
  // previous to detect runs of the same starting letter/word
  state.paragraphs.forEach(function(paragraph) {
    if (lastPara) {
      if (lastPara.firstWord === paragraph.firstWord) {
        sameWordCount += 1;
      } else {
        sameWordCount = 0;
      }
      // Skip any leading double-quote (dialogue)
      if (lastPara.firstWord[0] === paragraph.firstWord[0]) {
        sameLetterCount += 1;
      } else {
        sameLetterCount = 0;
      }
    }
    //
    if (sameWordCount == 1) {
      problems.push({
        type: 'firstWordDup',
        paraIndex: paragraph.index,
        severity: 'warn',
        start: 0,
        end: paragraph.firstWord.length
      });
    }
    if (sameWordCount > 1) {
      problems.push({
        type: 'firstWordDup',
        paraIndex: paragraph.index,
        severity: 'error',
        start: 0,
        end: paragraph.firstWord.length
      });
    }
    if (sameLetterCount == 1) {
      problems.push({
        type: 'firstLetterDup',
        paraIndex: paragraph.index,
        severity: 'review',
        start: 0,
        end: 1
      });
    }
    if (sameLetterCount > 1) {
      problems.push({
        type: 'firstLetterDup',
        paraIndex: paragraph.index,
        severity: 'warn',
        start: 0,
        end: 1
      });
    }
    lastPara = paragraph;
  });
}

/**
  Check for weak words
*/
util.checkWeakWords = function(state, problems) {
  var wordLocs, lastPara, sameLetterCount = 0, sameWordCount = 0;

//console.log("CheckWeakWords: Words List: " + JSON.stringify(state.words));

  Object.keys(state.words).forEach(function(word) {
    wordLocs = state.words[word];

//console.log("CheckWeakWords: Each Word: " + word + ": " + JSON.stringify(wordLocs));

    if (weakWordsList.find(function(weakWord) {
      return word === weakWord;
    })) {
      wordLocs.forEach(function(loc) {
        problems.push({
          type: 'weakWord',
          word: word,
          severity: 'review',
          paraIndex: loc[0],
          start: loc[1],
          end: loc[1] + word.length
        })
      })
    }
  });
}

/*
  Check for any words too close together.
*/
util.tooClose = function(state, problems) {




}


/**
  Load words from a CSV file into an array using an extract function
  and optional filter function.
*/
function loadWordList(fileName, list, extractFunc, filterFunc) {
  var parser, value;

  parser = csv({ trim: true }, function(err, data) {
    //console.log("Words record: " + JSON.stringify(data));
    data.forEach(function(record) {
      if (!filterFunc || filterFunc(record)) {
        value = extractFunc(record);
        //console.log("List add: " + value);
        list.push(value);
      }
    });
  });

  var input = fs.createReadStream(fileName);
  input.pipe(parser);  
}

var server_port = process.env.OPENSHIFT_NODEJS_PORT || 3000
var server_ip_address = process.env.OPENSHIFT_NODEJS_IP || '0.0.0.0'

app.listen(server_port, server_ip_address, function(){
  console.log("Listening on " + server_ip_address + ", server_port " + server_port)
});
