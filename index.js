
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

CORS_ORIGIN_WHITELIST = ["https://c2n.srg.id.au", "https://edutools.c2n.srg.id.au", "http://vcap.me"]

app.use(require('cors')({
    origin: "https://edutools.srg.id.au"
}));

app.all("/", (req, res) => res.redirect("https://edutools.srg.id.au"));

app.use("/actions/assn2db", require('./actions/assignments_to_db'));
app.use("/actions/calen2db", require('./actions/calendar_to_db'));

app.listen(process.env.PORT || 8080)