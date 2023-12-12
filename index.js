const cheerio = require('cheerio');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const http = require('http');
const url = require('url');
const fs = require('fs');
const { Client, NoAuth, MessageMedia } = require('whatsapp-web.js');
const querystring = require('querystring');
const FormData = require('form-data');
const { channel } = require('diagnostics_channel');

require('dotenv').config();

const API_KEY = process.env.API_KEY || null;
const API_URL = process.env.API_URL || null;
const HOST = process.env.HTTP_HOST || "127.0.0.1";
const PORT = process.env.HTTP_PORT || 4003;
const CHANNEL = process.env.CHANNEL || "Prueba";
const DB_PATH = process.env.DB_PATH || null;
const SOURCE_URL = process.env.SOURCE_URL.split(',') || null;

const type = (function(global) {
    var cache = {};
    return function(obj) {
        var key;
        return obj === null ? 'null' // null
            : obj === global ? 'global' // window in browser or global in nodejs
            : (key = typeof obj) !== 'object' ? key // basic: string, boolean, number, undefined, function
            : obj.nodeType ? 'object' // DOM element
            : cache[key = ({}).toString.call(obj)] // cached. date, regexp, error, object, array, math
            || (cache[key] = key.slice(8, -1).toLowerCase()); // get XXXX from [object XXXX], and cache it
    };
}(this));

const client = new Client(
    {
        authStrategy: new NoAuth(),
        puppeteer: {
            args: ['--no-sandbox'],
        }
    }
);

let msgObj = {
    msg: {
        to: {
            id: null,
            name: null,
            user: null
        }
    },
    updated: false
};

let bodyObj = { 
    object: {
        id: null,
        type: "",
        createdDate: "",
        canonicalUrl: null,
        canonicalUrlMobile: null,
        headlines: null,
        description: null,
        taxonomy: {
            category: null,
            website: null,
            section: null
        },
        og: {
            title: null,
            description: null,
            image: null
        },
    },
    updated: false
};

client.on('qr', async (qr) => {
    console.log('QR RECEIVED', qr);
    qrcode.generate(qr, {small: true});
});

client.on('authenticated', () => {
    console.log('AUTHENTICATED');
});

client.on('auth_failure', msg => {
    // Fired if session restore was unsuccessful
    console.error('AUTHENTICATION FAILURE', msg);
});

client.on('ready', async () => {
    msgObj.msg.to.id    = client.info.wid.user;
    msgObj.msg.to.user  = client.info.wid.user;
    msgObj.msg.to.name  = client.info.wid.name;

    console.log(client.info.wid.user);
    console.log('Client is Ready');
    getSendMsg();
});

client.on('message', async msg => {
    const isBroadcast = msg.broadcast || msg.isStatus;

    if(msg.type != "sticker" && msg.type != "image" && msg.type != "video"){
        if(msg.hasMedia == false){
            console.log(msg.type)
            getSendMsg();
        }

    }
});

client.on('disconnected', (reason) => {
    console.log('Client is disconected: ', reason);
    client.initialize();
});

client.initialize();

async function getSendMsg() {
    try{
        let sendMessageData = false;
        let streamResults = await checkAllStreams();
        let streamIsUp = streamResults.every(result => result.status === false);

        let objResponse = false;

        if (streamIsUp != false) {
            let objResponse = getSendChannelByPost(streamResults);
        }
            
        if(objResponse == false) {
            console.log(false);
        } else {
            sendMessageData = true;
        }

        return sendMessageData;
    } catch(e){
        console.log("Error Occurred: ", e);
    }
}

async function getSendChannelByPost(results) {
    try {
        if (!results || results.length === 0) {
            console.log('No streams to process.');
            return false;
        }

        let sendChannelData = false;
        //obj with information to publish
        
        let channelId = await getChannelId("Vallory");

        if(!Array.isArray(channelId) || channelId.length === 0) {
            return false;
        }

        for (let url of results) {  
            const message = `Alerta: ${url}`;
            sendChannelData = await client.sendMessage(channelId[0], message);        
        }

        return sendChannelData;
    } catch(e){
        console.log("Error Occurred: ", e);
        console.log("l: 161");
        return false;
    }
}

async function getChannelId(channelName) {
    const channels = await client.getChannels();
    const channelId = channels
        .filter(channel => channel.name == channelName)
        .map(channel => {
            return channel.id._serialized
        });

    console.log(channelId, 174);

    return channelId;
}

function writeJson(filepath, ids) {
    return new Promise((resolve, reject) => {
        let jsonData = JSON.stringify(ids, null, 2);

        fs.writeFile(filepath, jsonData, (err) => {
            if (err) {
                console.error('Error writing file:', err);
                reject(false);
            } else {
                console.log('File successfully written.');
                resolve(true);
            }
        });
    });
}

async function readJson(filepath) {
    if (!fs.existsSync(filepath)) {
        $emptyArray = await writeJson(filepath, []);
    }
    return fs.readFileSync(filepath, 'utf8');
}

function isJson(item) {
    if (typeof item !== "string") { return false; }
    if (!["{", "}", "[", "]"].some(value => item.includes(value))) { return false; }
    let value = typeof item !== "string" ? JSON.stringify(item) : item;

    try {
        value = JSON.parse(value);
    } catch (e) {
        console.log("Error Occurred: ", e);
        console.log("l: 280")
        return false;
    }
      
    return typeof value === "object" && value !== null;
}

async function checkAudioStream(url) {
    var status = false;
    try {
        const response = await axios.get(url, {
            timeout: 10000 // Timeout in milliseconds
        });
        // Check if the response is as expected for a live stream
        status = response.status;
        if (status === 200) {
            console.log('Stream is up');
            return false;
        } else {
            console.log('Stream down');
            return SOURCE_URL;
        }
    } catch (error) {
        console.error('Error: ', error.message);
        console.info(status);
        return SOURCE_URL;
    }
}

async function checkAllStreams() {
    let results = [];
    for (let url of SOURCE_URL) {
        const result = await checkAudioStream(url);
        results.push({ url, status: result });
        await delay(10000); // 10-second delay
    }
    return results;
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

setInterval(checkAllStreams, 30000); // checks every 30 seconds

async function fetchDataFromApis() {
    const apiUrl = API_URL + '?token=' + API_KEY;
    let data = null;

    try {
        const apiResponse = await axios.get(apiUrl);

        if(apiResponse.status == 200) {
            if(apiResponse.data.type == "results") {
                data = apiResponse.data.content_elements;
            }
        }

        return {
            data: data
        };
    } catch (error) {
        console.error('Error fetching data from APIs:', error);
        return null;
    }
}



process.on('unhandledRejection', (error) => {
    console.error('Unhandled Promise Rejection:', error);
});

const server = http.createServer((req, res) => {
    const baseURL =  req.protocol + '://' + req.headers.host + '/';
    const reqUrl = new URL(req.url,baseURL);

    if(reqUrl.pathname == "/msg") {
        if (req.method == 'POST') {
            let body = [];
            req.on('data', async (chunk) => {
                body.push(chunk);
            }).on('end', async () => {
                body = Buffer.concat(body).toString();
                console.log(body);
                // at this point, `body` has the entire request body stored in it as a string
                if(await getSendMsgByPost(body)) {
                    res.end(JSON.stringify({ status: 200, message: 'Success'}));
                } else {
                    res.end(JSON.stringify({ status: 500, message: 'Error'}));
                }
            });
        }


        client.getState().then((result) => {
            if(result.match("CONNECTED")){
                var q = url.parse(req.url, true).query;
                
                res.end(JSON.stringify({ status: 200, message: 'Log Out Success'}));
            } else {
                console.error("Whatsapp Client not connected");

                res.end(JSON.stringify({ status: 500, message: 'Client State Null'}));
            }
        });
    }

    if(reqUrl.pathname == "/channel") {
        if (req.method == 'POST') {
            let body = [];
            req.on('data', async (chunk) => {
                body.push(chunk);
            }).on('end', async () => {
                body = Buffer.concat(body).toString();
                if(await getSendChannelByPost(body)) {
                    res.end(JSON.stringify({ status: 200, message: 'Success'}));
                } else {
                    res.end(JSON.stringify({ status: 500, message: 'Error'}));
                }
            });
        }

        client.getState().then((result) => {
            if(result.match("CONNECTED")){
                var q = url.parse(req.url, true).query;
                
                res.end(JSON.stringify({ status: 200, message: 'Log Out Success'}));
            } else {
                console.error("Whatsapp Client not connected");

                res.end(JSON.stringify({ status: 500, message: 'Client State Null'}));
            }
        });
    }
    
    res.writeHead(200, {'Content-Type': 'text/html'});
    res.end();
}).listen(PORT); 
