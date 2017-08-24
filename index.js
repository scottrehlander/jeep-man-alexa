'use strict';

const Alexa = require('alexa-sdk');
const https = require('https');
const moment = require('moment');
const zipToLatLong = require('./zipToLatLong.js');
const secrets = require('./secrets.js');

var userZip = null;

var precipChanceEnum = {
	NONE: 0,
	UNLIKELY: 1,
	LIKELY: 2
}

var handlers = {

	'AMAZON.HelpIntent': function() {
		this.emit(':ask', 'Welcome to JeepMan, developed by Scott Rehlander. Ask me if you should take your top down.');
	},

	'AMAZON.StopIntent': function() {
		this.emit(':tell', 'Ok');
	},

	'AMAZON.CancelIntent': function() {
		this.emit(':tell', 'Ok');
	},

	'LaunchRequest': function() {
		this.emit(':ask', 'Welcome to Jeep Man, developed by Scott Rehlander. Ask me if you can take your top down.');
	},

	'Unhandled': function() {
		this.emit(':tell', 'You may only ask Jeep Man if you should take your top down.');
	},

	// Skill to check if the user should take the top off today
    'TopOffToday': function () {
        var self = this;
		
		// Grab the zip code of the device and convert it to lat/long for the Dark Sky API
		var latLong = zipToLatLong(userZip);
		console.log(`Got Lat/Long of device: ${JSON.stringify(latLong)}`);

		if(!latLong) {
			console.error(`Could not find the lat/long for the zip: ${userZip}`);

			self.emit(':tell', `Sorry, I cannot find weather information for your zip code.`);
			return;
		}
        
        // Grab the weather data from the Dark Sky API
        https.get(`https://api.darksky.net/forecast/${secrets.darkSkyApiKey}/${latLong.LAT},${latLong.LNG}?exclude=currently,minutely,daily,alerts,flags`, (res) => {
            const { statusCode } = res;
            const contentType = res.headers['content-type'];
            
            let error;
            if (statusCode !== 200) {
                error = new Error('Request Failed.\n' + `Status Code: ${statusCode}`);
            } 
            else if (!/^application\/json/.test(contentType)) {
                error = new Error('Invalid content-type.\n' + `Expected application/json but received ${contentType}`);
            }
            
            if (error) {
                console.error(`Error encountered when calling https get: ${error.message}`);
				
				// Consume response data to free up memory
                res.resume();
                
                self.emit(':tell', `Sorry, I was unable to fetch the weather data.`);
                return;
            }
            
            res.setEncoding('utf8');
            let rawData = '';
            res.on('data', (chunk) => { rawData += chunk; });
            res.on('end', () => {
                try {
                    const parsedData = JSON.parse(rawData);
					console.log(`Got data from the Dark Sky API ${JSON.stringify(parsedData)}`);
					
					var localTimeNow = moment.utc().utcOffset(parsedData.offset);
					var localDayNow = localTimeNow.get('day');

					var today = [];
					var tonight = [];
					var tomorrowDay = [];

					console.log(`Local time is now: ${localTimeNow.toString()}, local day is ${localTimeNow.get('day')}`);
            
					parsedData.hourly.data.forEach((hourlyDataPoint) => {
						console.log(`Checking hourly data point for chance of rain: ${JSON.stringify(hourlyDataPoint)}`);

						var localTime = moment.utc(hourlyDataPoint.time, 'X').utcOffset(parsedData.offset);
						var localDay = localTime.get('day');

						console.log(`Time of data point is: ${localTime.toString()}`);

						if (localDay == localDayNow) {
							if(localTime.get('hour') < 19) {
								console.log(`This data point is for today`);

								today.push(hourlyDataPoint);
							} else {
								console.log(`This data point is for tonight`);

								tonight.push(hourlyDataPoint);
							}
						} 
						else if ((localDay == localDayNow + 1) || (localDay == 0 && localDayNow == 7)) {
							if(localTime.get('hour') < 8) {
								console.log(`This data point is for extremely early tomororw morning, so add it to tonight`);

								tonight.push(hourlyDataPoint);
							}
							else if(localTime.get('hour') < 19) {
								console.log(`This data point is for tomorrow during the day`);

								tomorrowDay.push(hourlyDataPoint);
							}
							else {
								console.log(`This data point is for tomorrow night, exclude it`);
							}
						} 
						else {
							console.log('This data point is for the day after tomorrow');
						}
					});

					var todayPrecip = getChanceOfPrecip(today);
					var tonightPrecip = getChanceOfPrecip(tonight);
					var tomorrowDayPrecip = getChanceOfPrecip(tomorrowDay);

					// Today is not over
					if(today.length > 0) {
						switch (todayPrecip.chance) {
							case precipChanceEnum.NONE:
								switch(tonightPrecip.chance) {
									case precipChanceEnum.NONE:
										// It won't rain today or tonight
										self.emit(':tell', `All looks clear, there should be no precipitation today or tonight.`);
										break;
									case precipChanceEnum.UNLIKELY:
										// It won't rain today, but might tonight
										self.emit(':tell', `There should be no precipitation today, but be careful because there is a ${Math.round((tonightPrecip.chanceProbability * 100)).toString()} percent chance of precipitation tonight.`);
										break;
									case precipChanceEnum.LIKELY:
										// It won't rain today, but probably will tonight
										self.emit(':tell', `You should be okay today, but be careful because there is a ${Math.round((tonightPrecip.chanceProbability * 100)).toString()} percent chance of precipitation tonight.`);
										break;		
								}
								break;
							case precipChanceEnum.UNLIKELY:
								switch(tonightPrecip.chance) {
									case precipChanceEnum.NONE:
										// It might today but not tonight
										self.emit(':tell', `Be careful, there is a ${Math.round((todayPrecip.chanceProbability * 100)).toString()} percent chance of precipitation today, but tonight should be clear.`);
										break;
									case precipChanceEnum.UNLIKELY:
										// It might rain today and might rain tonight
										self.emit(':tell', `Be careful, there is a ${Math.round((todayPrecip.chanceProbability * 100)).toString()} percent chance of precipitation today and a ${Math.round((tonightPrecip.chanceProbability * 100)).toString()} percent chance of precipitation tonight.`);
										break;
									case precipChanceEnum.LIKELY:
										// It might rain today and will likely rain tonight
										self.emit(':tell', `Be careful, there is a ${Math.round((todayPrecip.chanceProbability * 100)).toString()} percent chance of precipitation today. But you should put your top on tonight because there is a ${Math.round((tonightPrecip.chanceProbability * 100)).toString()} percent chance of precipitation.`);
										break;		
								}
								break;
							case precipChanceEnum.LIKELY:
								switch(tonightPrecip.chance) {
									case precipChanceEnum.NONE:
										// It will probably rain today but won't tonight
										self.emit(':tell', `There is a ${Math.round((todayPrecip.chanceProbability * 100)).toString()} percent chance of precipitation today. But you could put your top down tonight, it should be clear.`);
										break;
									case precipChanceEnum.UNLIKELY:
										// It will probably rain today and it might rain tonight
										self.emit(':tell', `There is a ${Math.round((todayPrecip.chanceProbability * 100)).toString()} percent chance of precipitation today. But you might be able to put your top down tonight, there is a ${Math.round((tonightPrecip.chanceProbability * 100)).toString()} percent chance of precipitation.`);
										break;
									case precipChanceEnum.LIKELY:
										// It will probably rain today and tonight
										self.emit(':tell', `There is a ${Math.round((todayPrecip.chanceProbability * 100)).toString()} percent chance of precipitation today and a ${Math.round((tonightPrecip.chanceProbability * 100)).toString()} percent chance of precipitation tonight.`);
										break;		
								}
								break;
						}
					}
					// Today is over
					else {
						switch (tonightPrecip.chance) {
							case precipChanceEnum.NONE:
								switch(tomorrowDayPrecip.chance) {
									case precipChanceEnum.NONE:
										// It won't rain tonight or tomorrow during the day
										self.emit(':tell', `All looks good, there should be no precipitation tonight or tomorrow morning.`);
										break;
									case precipChanceEnum.UNLIKELY:
										// It won't rain tonight, but might tomorrow during the day
										self.emit(':tell', `Tonight looks good. There should be no precipitation tonight, but be careful because there is a ${Math.round((tomorrowDayPrecip.chanceProbability * 100)).toString()} percent chance of precipitation tomorrow during the day.`);
										break;
									case precipChanceEnum.LIKELY:
										// It won't rain tonight, but probably will tomorrow during the day
										self.emit(':tell', `You should be okay tonight, but make sure to put your top on before tomorrow because there is a ${Math.round((tomorrowDayPrecip.chanceProbability * 100)).toString()} percent chance of precipitation during the day.`);
										break;		
								}
								break;
							case precipChanceEnum.UNLIKELY:
								switch(tomorrowDayPrecip.chance) {
									case precipChanceEnum.NONE:
										// It might rain tonight but not tomorrow during the day
										self.emit(':tell', `Careful, there is a ${Math.round((tonightPrecip.chanceProbability * 100)).toString()} percent chance of precipitation tonight, but tomorrow during the day should be clear.`);
										break;
									case precipChanceEnum.UNLIKELY:
										// It might rain tonight and might rain tomorrow during the day
										self.emit(':tell', `Be careful, there is a ${Math.round((tonightPrecip.chanceProbability * 100)).toString()} percent chance of precipitation tonight and a ${Math.round((tomorrowDayPrecip.chanceProbability * 100)).toString()} percent chance of precipitation tomorrow during the day.`);
										break;
									case precipChanceEnum.LIKELY:
										// It might rain tonight and will likely rain tomorrow during the day
										self.emit(':tell', `Be careful, there is a ${Math.round((tonightPrecip.chanceProbability * 100)).toString()} percent chance of precipitation tonight. But you should put your top on before tomorrow because there is a ${Math.round((tomorrowDayPrecip.chanceProbability * 100)).toString()} percent chance of precipitation during the day.`);
										break;		
								}
								break;
							case precipChanceEnum.LIKELY:
								switch(tomorrowDayPrecip.chance) {
									case precipChanceEnum.NONE:
										// It will probably rain tonight but won't tomorrow during the day
										self.emit(':tell', `There is a ${Math.round((tonightPrecip.chanceProbability * 100)).toString()} percent chance of precipitation tonight. But you could put your top down tomorrow during the day, it should be clear.`);
										break;
									case precipChanceEnum.UNLIKELY:
										// It will probably rain tonight and it might rain tomorrow during the day
										self.emit(':tell', `There is a ${Math.round((tonightPrecip.chanceProbability * 100)).toString()} percent chance of precipitation tonight. But you might be able to put your top down tomorrow during the day. There is a ${Math.round((tomorrowDayPrecip.chanceProbability * 100)).toString()} percent chance of precipitation.`);
										break;
									case precipChanceEnum.LIKELY:
										// It will probably rain tonight and tomorrow during the day
										self.emit(':tell', `There is a ${Math.round((tonightPrecip.chanceProbability * 100)).toString()} percent chance of precipitation tonight and a ${Math.round((tomorrowDayPrecip.chanceProbability * 100)).toString()} percent chance of precipitation tomorrow during the day.`);
										break;		
								}
								break;
						}
					}

					// We should have emitted some speech
					return;
                } catch (e) {
					console.error(`Error while completing response: ${e.message}`);
					
					self.emit(':tell', `Sorry, I was unable to complete the request to fetch weather data.`);
					return;
                }
            });
        }).on('error', (e) => {
			console.error(`Error while calling https: ${e.message}`);

			self.emit(':tell', 'Sorry, I could not make a secure request to the Weather service..');    
			return;
        });
    }
    
};

var getChanceOfPrecip = function(dataPoints) {
	var chanceProbability = 0;
	var chanceEnum = -1;

	if(dataPoints.length > 0) {
		dataPoints.forEach((dataPoint) => {
			// If the data point for chance of precip is higher, set that as the current max
			chanceProbability = dataPoint.precipProbability > chanceProbability ? 
				dataPoint.precipProbability : chanceProbability;
		});
	}

	// Set an enum for speech purposes
	if(chanceProbability < .05) {
		chanceEnum = precipChanceEnum.NONE;
	} 
	else if (chanceProbability >= .05 && chanceProbability < .25) {
		chanceEnum = precipChanceEnum.UNLIKELY;
	}
	else {
		chanceEnum = precipChanceEnum.LIKELY;
	}

	return {
		chanceProbability: chanceProbability,
		chance: chanceEnum
	};
}

var setUserZip = (user, device) => {
	var self = this;

	return new Promise((resolve, reject) => {

		if(!user.permissions || !user.permissions.consentToken) {
			console.log('Could not get consent token for user');

			reject(new Error(`You must consent to providing your zip code for Jeep Man to work.`));
			return;
		}

		let consentToken = user.permissions.consentToken;

		console.log(`About to make https request to Amazon Api for user zip code: https://api.amazonalexa.com/v1/devices/${device.deviceId}/settings/address/countryAndPostalCode with consentToken ${consentToken}`);

		// Grab the weather data from the Dark Sky API
        https.get({
			host: `api.amazonalexa.com`,
			port: 443,
			path: `/v1/devices/${device.deviceId}/settings/address/countryAndPostalCode`,
			headers: {
				Authorization: `Bearer ${consentToken}`
			}
		}, (res) => {
			console.log('Https request made to Alexa API');

            const { statusCode } = res;
            const contentType = res.headers['content-type'];
            
            let error;
            if (statusCode !== 200) {
                error = new Error('Request Failed.\n' + `Status Code: ${statusCode}`);
            } 
            else if (!/^application\/json/.test(contentType)) {
                error = new Error('Invalid content-type.\n' + `Expected application/json but received ${contentType}`);
            }
            
            if (error) {
                console.error(`Error encountered when calling https get: ${error.message}`);
				
				// Consume response data to free up memory
                res.resume();
				
				reject(new Error(`Sorry, I was unable to fetch the weather data.`));
                return;
			}
			
			console.log('Setting encoding for https request');
            
            res.setEncoding('utf8');
            let rawData = '';
            res.on('data', (chunk) => { rawData += chunk; });
            res.on('end', () => {
                try {
					console.log('Https request completed for zip code API');
					
					const parsedData = JSON.parse(rawData);
					console.log(`Got data from the Alexa address API: ${JSON.stringify(parsedData)}`);

					resolve(parsedData.postalCode);
					return;
                } catch (e) {
					console.error(`Error while completing response: ${e.message}`);
					
					reject(new Error(`Sorry, I was unable to complete the request to fetch your zip code.`));
					return;
                }
            });
        }).on('error', (e) => {
			console.error(`Error while calling https: ${e.message}`);

			reject(new Error(`Sorry, I could not make a secure request to the Alexa zip code service.`));
			return;
        });
	});
}

exports.handler = function (event, context, callback) {
	// Set up the Alexa sdk
	var alexa = Alexa.handler(event, context, callback);
	alexa.registerHandlers(handlers);
	alexa.appId = secrets.appId;
	
	console.log(`About to set user zip for user id ${event.context.System.user.userId} and device id ${event.context.System.device.deviceId}`);

	setUserZip(event.context.System.user, event.context.System.device).then((zip) => {
		console.log(`Got user zip for user id ${event.context.System.user.userId} and device id ${event.context.System.device.deviceId}: ${zip}`);

		// Set the zip code
		userZip = zip;

		// Execute the skill
		alexa.execute();
	}).catch((err) => {
		// There was an issue getting the zip code
		console.error('Could not get user zip: ' + JSON.stringify(err.message));

		alexa.emit(':tell', 'Sorry, we could not get the zip code associated with your device. Please make sure you have provided consent for location data');
		return;
	});
};
