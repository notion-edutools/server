
require('dotenv').config();

const express = require('express');
const app = express();

const limiter = require('express-rate-limit')({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 50 // limit each IP to 50  requests per windowMs
});

app.set('trust proxy', 1);

app.use(limiter);
app.use(express.json());

CORS_ORIGIN_WHITELIST = ["https://c2n.srg.id.au", "https://edutools.c2n.srg.id.au"]

app.use(require('cors')({
    origin: (o, c) => {

        // Remove !o to disallow server-to-server requests.
        if (CORS_ORIGIN_WHITELIST.includes(o) || !o) {
            return c(null, true);
        } else {
            console.warn("Request was made to server from origin " + o + " which has been blocked by CORS.")
            return c('Cross origin request from origin ' + o + ' is denied.', false);
        }

    }
}));

app.all("/", (req, res) => res.redirect("https://c2n.srg.id.au"));

app.use("/actions/assn2db", require('./actions/assignments_to_db'));
app.use("/actions/calen2db", require('./actions/calendar_to_db'));

app.listen(process.env.PORT || 8080)