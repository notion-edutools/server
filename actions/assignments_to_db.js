
const express = require("express");
const router = express.Router();

const c = require('canvas-lms-api');
const { Client } = require('@notionhq/client');
const { htmlToText } = require('html-to-text');

const axios = require('axios');
const auth_header = "Basic " + Buffer.from(process.env.NOTION_CLIENT_ID + ":" + process.env.NOTION_CLIENT_SECRET).toString('base64');
console.log(auth_header);

let grant_tokens = {}

// router.get("/", (req, res) => res.status(400).json({success: false, message: "You can only POST here. Please check https://c2n.srg.id.au for more info."}))

router.post("/", async (req, res) => {

    if (!( req.body.cdom && req.body.cid && req.body.notionUri && req.body.ctoken && req.body.notion_token )) {
        return res.status(400).json({
            success: false,
            message: "One or more parameters is missing.",
            params_given: Object.keys(req.body),
            params_required: ['cdom', 'cid', 'notionUri', 'ctoken', 'notion_token']
        });
    }

    let notion;
    
    if (!grant_tokens[req.body.notion_token]) {
        let token_response;

        try {
            token_response = await axios.post("https://api.notion.com/v1/oauth/token", {
                "grant_type": "authorization_code",
                "code": req.body.notion_token,
                "redirect_uri": process.env.NOTION_REDIRECT_URI
            }, {
                headers: {
                    'Authorization': auth_header,
                    'Content-Type': 'application/json'
                }
            });
        } catch (e) {
            return res.status(403).json({
                success: false,
                message: "Error while authenticating to Notion. Try reauthenticating - scroll up and press the button.",
                oauth_error: e.response.data.error || null,
                reauth: e.response.data.error === "invalid_grant"
            });
        }

        if (token_response.data.error) {
            return res.status(403).json({
                success: false,
                message: "Error while authenticating to Notion. Try reauthenticating - scroll up and press the button.",
                oauth_error: token_response.data.error,
                reauth: token_response.data.error === "invalid_grant"
            });
        }

        grant_tokens[req.body.notion_token] = token_response.data.access_token;
        notion = new Client({ auth: token_response.data.access_token });  

    } else {
        notion = new Client({ auth: grant_tokens[req.body.notion_token] });
    }

    const frags = req.body.notionUri.split("?")[0].split("/");
    const db_id = (frags[frags.length - 1] == '') ? frags[frags.length - 2] : frags[frags.length - 1];

    if (db_id.length !== 32) {
        return res.status(400).json({
            success: false,
            message: "The Notion URL was not able to be parsed. Make sure it's in the format https://www.notion.so/user/380c311b9e2d4XXXX6c0125316a255d8 or https://www.notion.so/380c311b9e2d4XXXX6c0125316a255d8."
        });
    }

    const canvas = new c("https://" + req.body.cdom, {
        accessToken: req.body.ctoken
    });

    canvas.get('courses/' + req.body.cid + "/assignments").then(async (r) => {

        r.forEach(async (assn) => {

            good_description = htmlToText(assn.description);

            await notion.pages.create({

                parent: {
                    database_id: req.body.notionUri.split("?")[0].split("/")[4]
                },
        
                properties: {

                    Name: {
                        title: [
                            {
                                text: {
                                    content: assn.name
                                }
                            }
                        ]
                    },

                    Description: {
                        rich_text: [
                            {
                                text: {
                                    content: (good_description.length < 100) ? good_description : (good_description.substring(0, 97) + "...")
                                }
                            }
                        ]
                    },

                    // Not sure how to get this from the API, for now just get the user change it.
                    
                    // Done: {
                    //     checkbox: assn.has_submitted_submissions || false
                    // },

                    IncludedInFinalGrade: {
                        checkbox: !assn.omit_from_final_grade
                    },

                    Locked: {
                        checkbox: assn.locked_for_user
                    },

                    Due: {
                        date: {
                            start: assn.due_at,
                            end: assn.due_at
                        }
                    },

                    URL: {
                        url: assn.html_url
                    }

                }

            }).catch(e => res.status(500).json({
                success: false,
                message: "Unknown error while creating Notion table.",
                error: e
            }));

        });

    }).then(() => {
        return res.json({
            success: true,
            message: "Completed insertion."
        });
    }).catch(e => {
        res.status(500).json({
            success: false,
            message: "Unknown error while fetching Canvas data. Check your access token.",
            error: e
        });

        throw e;
    });

})

module.exports = router;