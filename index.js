/**
 *
 */

// Dependencies
const fs = require('fs');
const path = require('path');
const _ = require('lodash');
const Twitter = require('twitter');
const hash = require('object-hash');
const mkdirp = require('mkdirp');
const csv = require('d3-dsv').dsvFormat(',');
const debug = require('debug')('follownet');

// Load env
require('dotenv').load();

// Create client
const twit = new Twitter({
  consumer_key: process.env.TWITTER_CONSUMER_KEY,
  consumer_secret: process.env.TWITTER_CONSUMER_SECRET,
  access_token_key: process.env.TWITTER_ACCESS_TOKEN,
  access_token_secret: process.env.TWITTER_ACCESS_SECRET
});

// Location of cache
let cachePath = path.join(__dirname, '.cache');
const NO_CACHE = false;
mkdirp.sync(cachePath);

// Location of output
let outputPath = path.join(__dirname, 'output');
mkdirp.sync(outputPath);

// List of usernames
let usernames = [];

analysis().catch(error);

// Do ananlysis
async function analysis() {
  let all = await getNetworks(usernames);
  let combined = [];

  // Flatten
  _.each(all, u => {
    _.each(u.followers, f => {
      combined.push({
        type: 'follower',
        of: u.username,
        id: f
      });
    });
    _.each(u.friends, f => {
      combined.push({
        type: 'friend',
        of: u.username,
        id: f
      });
    });
  });

  // Group by id
  let grouped = _.sortBy(_.groupBy(combined, 'id')).reverse();

  // Get data on the most popular
  let details = await getDetails(
    _.map(_.take(grouped, 1000), g => {
      return g[0].id;
    })
  );
  details = _.keyBy(details, 'id_str');

  // Match up
  grouped = _.map(grouped, g => {
    let m = {};
    m.id = g[0].id;
    m.details = details[g[0].id];
    m.network = g;
    return m;
  });

  // Save as JSON
  fs.writeFileSync(
    path.join(outputPath, 'all--network.json'),
    JSON.stringify(grouped)
  );

  // Create CSV, only write ones we have details for
  fs.writeFileSync(
    path.join(outputPath, 'all--network.csv'),
    csv.format(
      _.filter(
        _.map(grouped, g => {
          if (!g.details) {
            return;
          }
          else {
            return {
              id: g.id,
              username: g.details.screen_name,
              name: g.details.name,
              location: g.details.location,
              description: g.details.description,
              url: g.details.url,
              followers: g.details.followers_count,
              friends: g.details.friends_count,
              verified: g.details.verified,
              follower_of_count: _.filter(g.network, { type: 'follower' })
                .length,
              follower_of: _.map(
                _.filter(g.network, { type: 'follower' }),
                'of'
              ).join(', '),
              friend_of_count: _.filter(g.network, { type: 'friend' }).length,
              friend_of: _.map(
                _.filter(g.network, { type: 'friend' }),
                'of'
              ).join(', ')
            };
          }
        })
      )
    )
  );
}

// Get details from user ids
async function getDetails(userIDs) {
  let details = [];

  try {
    for (let i = 0; i < userIDs.length; i = i + 100) {
      let d = await getAll('post', 'users/lookup', {
        user_id: _.slice(userIDs, i, i + 100).join(',')
      });
      details = details.concat(d);
    }

    return _.flatten(details);
  }
  catch (e) {
    error(e);
  }
}

// Get networks for multiple usernames
async function getNetworks(usernames) {
  let all = [];

  try {
    for (let u of usernames) {
      u = u.replace(/@/g, '');
      let n = await getNetwork(u);
      all.push(n);
      fs.writeFileSync(
        path.join(outputPath, u + '--network.json'),
        JSON.stringify(n)
      );
    }

    return all;
  }
  catch (e) {
    error(e);
  }
}

// Get network for usernames
async function getNetwork(username) {
  try {
    let followers = await getFollowers(username);
    let friends = await getFriends(username);
    debug(
      'Network for',
      username,
      'Followers',
      followers.length,
      'Friends',
      friends.length
    );

    return {
      username: username,
      followers: followers,
      friends: friends
    };
  }
  catch (e) {
    error(e);
  }
}

// Get followers for user
async function getFollowers(username) {
  try {
    let all = await getAll('get', 'followers/ids', {
      screen_name: username,
      stringify_ids: true,
      count: 5000
    });

    return _.flatten(_.map(all, 'ids'));
  }
  catch (e) {
    error(e);
  }
}

// Get friends (the people that they follow) for user
async function getFriends(username) {
  try {
    let all = await getAll('get', 'friends/ids', {
      screen_name: username,
      stringify_ids: true,
      count: 5000
    });

    return _.flatten(_.map(all, 'ids'));
  }
  catch (e) {
    error(e);
  }
}

// Get all for the twitter client
async function getAll(method = 'get', ...args) {
  let cursor = '0';
  let responses = [];

  while (cursor) {
    try {
      let a = [...args];
      a[1] = a[1] || {};
      a[1].cursor = cursor === '0' ? undefined : cursor;

      let response = await cacheTwitter(method, ...a);
      responses.push(response);
      if (response.next_cursor_str && response.next_cursor_str !== '0') {
        cursor = response.next_cursor_str;
      }
      else {
        cursor = false;
      }
    }
    catch (e) {
      cursor = false;
      error(e);
    }
  }

  return responses;
}

// Cache call to twitter client
async function cacheTwitter(method = 'get', ...args) {
  let id = hash([...args]);
  let asset = path.join(cachePath, id);

  // Check for asset
  if (!NO_CACHE && fs.existsSync(asset)) {
    debug('Cache hit: ', JSON.stringify([...args]));
    return JSON.parse(fs.readFileSync(asset, 'utf-8'));
  }

  try {
    let response = await twit[method](...args);
    fs.writeFileSync(asset, JSON.stringify(response));
    debug('Cache not hit: ', JSON.stringify([...args]));
    return response;
  }
  catch (e) {
    error(e, 'Error calling: ' + JSON.stringify([...args]));
  }
}

// Handle error
function error(e, message) {
  if (message) {
    console.error(message);
  }

  console.error(e);
  process.exit(1);
}
