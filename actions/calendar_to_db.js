
const express = require("express");
const router = express.Router();

const c = require('canvas-lms-api');
const { Client } = require('@notionhq/client');

// Render Canvas description as text for the database
const { htmlToText } = require('html-to-text');

const axios = require('axios');

// Generate the authorization header from our client ID and secret - stored in the environment.
// Must be encoded in Base64, see https://developers.notion.com/docs/authorization
const auth_header = "Basic " + Buffer.from(process.env.NOTION_CLIENT_ID + ":" + process.env.NOTION_CLIENT_SECRET).toString('base64');
console.log(auth_header);

// Save grant tokens in memory - this prevents users from having to reauthenticate every time.
// When the compute instance is shut down by the load balancer (e.g during periods of no load), this will be reset, but that's fine - it's only an extra button for the user to click.

// == How Notion authorization flow works ==
// The authorization code allows us to make a request to get the OAuth token. The OAuth token allows us to interact with Notion's API.
// Frontend:
// 1. User clicks on the 'Authorize' button and is taken through the flow.
// 2. Notion gives the browser a authorization code and the front end stores it in the browser's local storage.
// 3. When the user sends a request to the server, the auth code is also sent along with it.
// Server:
// 4. Server recieves the auth code.
// 5. If the auth code is in memory, we use the OAuth token that is stored.
// 5. If the auth code is NOT in memory, we make a request to Notion's API and send the auth code, this gives us the OAuth token.
// 6. We store the auth code in memory along with the associated OAuth token.

let grant_tokens = {}

// Deny get requests to this endpoint
router.get("/", (req, res) => res.status(400).json({success: false, message: "You can only POST here. Please check https://c2n.srg.id.au for more info."}))

// Get post requests
router.post("/", async (req, res) => {

    // Verify that all the parameters are included and return an error if not.
    if (!( req.body.cdom && req.body.notionUri && req.body.ctoken && req.body.notion_token )) {
        return res.status(400).json({
            success: false,
            message: "One or more parameters is missing.",
            params_given: Object.keys(req.body).filter(X=>req.body[X]),
            params_required: ['cdom', 'notionUri', 'ctoken', 'notion_token']
        });
    }
    
    // Define this variable beforehand so that we can set it based on whether the token is in memory.
    let notion;
    
    // If t
    if (!grant_tokens[req.body.notion_token] || req.body.disable_cache) {
        let token_response;

        try {
            // Make request for authorization code
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

            // If there is an error
            // "invalid_grant" usually means we have recieved the same authorization code twice, and not used the stored one. We tell the user to reauthorize.
            // "invalid_client" usually means that there is a bug in the server.
            return res.status(403).json({
                success: false,
                message: "Error while authenticating to Notion. Try reauthenticating - scroll up and press the button.",
                oauth_error: e.response.data.error || null,
                reauth: e.response.data.error === "invalid_grant"
            });

        }
        
        // If there is an error
        // "invalid_grant" usually means we have recieved the same authorization code twice, and not used the stored one. We tell the user to reauthorize.
        // "invalid_client" usually means that there is a bug in the server.
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

    // Get the Notion database ID, bugfix to fix problem identified by /u/nta103
    // Split by / to get URL path.
    const frags = req.body.notionUri.split("?")[0].split("/");
    
    // Get the last one, if this is empty then the URL probably ends with /, so get the second last one.
    const db_id = (frags[frags.length - 1] == '') ? frags[frags.length - 2] : frags[frags.length - 1];

    // If the length is not 32, then it's invalid.
    if (db_id.replace("-","").length !== 32) {
        return res.status(400).json({
            success: false,
            message: "The Notion URL was not able to be parsed. Make sure it's in the format https://www.notion.so/user/380c311b9e2d4XXXX6c0125316a255d8 or https://www.notion.so/380c311b9e2d4XXXX6c0125316a255d8."
        });
    }

    // Instantiate the Canvas API with the token we got from the client.
    const canvas = new c("https://" + req.body.cdom, {
        accessToken: req.body.ctoken
    });

    let courses, user, canvas_opts = {
        end_date: "2050-06-05T14:00:00.000Z",
        per_page: 1000
    };

    if (req.body.return_events) {

        canvas_opts.type = "event";

        try {
            user = await canvas.get("users/self/profile");
        } catch(e) {
            return res.status(400).json({
                success: false,
                message: `Error getting Canvas user. Is the authorization token correct?`,
                error: e
            });
        }

        canvas_opts.context_codes = [ "user_" + user.id ];

    } else {

        canvas_opts.type = "assignment";

        try {
            courses = await canvas.get("courses");
        } catch (e) {
            return res.status(400).json({
                success: false,
                message: `Error getting Canvas courses. Is the authorization token correct?`,
                error: e
            });
        }

        canvas_opts.context_codes = courses.map(e => "course_" + e.id);

    }

    // Get calendar events and put then into the database
    canvas.get("calendar_events", canvas_opts).then(r => {

        r.forEach(async (event) => {

            let title, course, description, finalGrade, locked, due_start, due_end, url;
            if ( req.body.return_events ) {

                title = event.title;
                due_start = event.start_at;
                due_end = event.end_at;

                description = htmlToText(event.description || "[no description]");
                course = event.context_name;
                url = event.html_url || "https://google.com";
                locked = false;

                finalGrade = false;

            } else {

                let assn = event.assignment;

                title = event.title;
                description = htmlToText(event.description);
                course = courses.filter(c => (c.id === assn.course_id))[0].name;

                url = assn.html_url;
                locked = assn.locked_for_user;

                due_start = assn.due_at;
                due_end = null;
                finalGrade = !assn.omit_from_final_grade;

            }

            // Create a page under the database.
            await notion.pages.create({

                parent: {
                    // Parent is the database from the ID.
                    database_id: db_id
                },
        
                properties: {

                    Name: {
                        title: [
                            {
                                text: {
                                    content: title
                                }
                            }
                        ]
                    },

                    Course: {
                        rich_text: [
                            {
                                text: {
                                    content: course
                                }
                            }
                        ]
                    },

                    Description: {
                        rich_text: [
                            {
                                text: {
                                    // Limit to 100 chars
                                    content: (description.length < 100) ? description : (description.substring(0, 97) + "...")
                                }
                            }
                        ]
                    },

                    // Not sure how to get this from the API, for now just get the user to change it.
                    
                    // Done: {
                    //     checkbox: assn.has_submitted_submissions || false
                    // },

                    IncludedInFinalGrade: {
                        checkbox: finalGrade
                    },

                    Locked: {
                        checkbox: locked
                    },

                    Due: {
                        date: {
                            start: due_start,
                            end: due_end
                        }
                    },

                    URL: {
                        url: url
                    }

                }

            }).catch(e => res.status(500).json({
                success: false,
                message: "Unknown error while creating Notion table.",
                error: e
            }));

        })

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

});

module.exports = router;
