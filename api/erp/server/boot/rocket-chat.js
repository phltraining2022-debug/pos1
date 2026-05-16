


/* 
    Create sync a new user in Rocket.Chat by calling the Rocket.Chat REST API
    example below
    curl --request POST \
        --url http://chat.vvs.vn:3000/api/v1/users.register \
        --header 'accept: application/json' \
        --header 'content-type: application/json' \
        --data '{
        "username": "thanh",
        "email": "thanh@example.com",
        "pass": "passw0rd",
        "name": "Roger Smith"
        }'

 */

async function syncUserToRocketChat(user) {
    const axios = require('axios');
    const rocketChatUrl = 'http://chat.vvs.vn:3000/api/v1/users.register';
    const rocketChat = {
        username: user.username,
        email: user.email,
        pass: user.password,
        name: user.name
    };
    try {
        const response = await axios.post(rocketChatUrl, rocketChat);
        console.log(response.data);
    } catch (error) {
        console.error(error);
    }
}

async function createCustomer() {
    const axios = require('axios');
    const strongloopAPIUrl = 'https://tl.prod.live1.vn/api/customers';
    const account = {
        email: 't4.tl@vastbit.com',
        password: 'passw0rd',
        name: 'thanh-test1',
        phone: '0123456782',
    };
    try {
        const response = await axios.post(strongloopAPIUrl, account);
        console.log(response.data);
    } catch (error) {
        console.error(error);
    }
}



async function doSync() {
    // await syncUserToRocketChat({ username: 'ben6', email: 'ben5.law@vastbit.com', password: 'passw0rd', name: 'Roger Smith' });    
    // await syncUserToRocketChat({ username: 'ben7', email: 'ben6.law@vastbit.com', password: 'passw0rd', name: 'Roger Smith' });    
    
    await createCustomer();

};

// call doSync to sync user to Rocket.Chat wait unitl it finish

// doSync();

