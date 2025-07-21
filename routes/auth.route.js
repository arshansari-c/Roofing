import express from 'express'
import { login,  Profile, register } from '../controllers/auth.controller.js'
import { CheckAuth } from '../middlewares/CheckAuth.js'
import { EditSupplierDetails, fetchSupplierList, SupplierDetails } from '../controllers/supplier.controller.js'
import { EditFreelancerDetails, fetchFreelancerList, FreelancerDetails,fetchOtherUserDetails } from '../controllers/freelancer.controller.js'
import { cancelOrder, ConversetionChat, fetchConversationChat, fetchOrders, fetchSelectedOrderDetails, SendOrderToContractor } from '../controllers/conversation.controller.js'

export const AuthRouter = express.Router()

AuthRouter.post('/register',register)
AuthRouter.post('/login',login)
AuthRouter.post('/profile/:token', Profile)
AuthRouter.post('/supplierdetails/:token',SupplierDetails)
AuthRouter.post('/supplierdetailsedit',CheckAuth,EditSupplierDetails)
AuthRouter.post('/freelancerdetails/:token',FreelancerDetails)
AuthRouter.get('/fetchorder/:token/:seconduser',fetchOtherUserDetails)
AuthRouter.post('/freelancerdetailedit',CheckAuth,EditFreelancerDetails)
AuthRouter.get('/fetchfreelancerlist/:token',fetchFreelancerList)
AuthRouter.get('/fetchsupplierlist/:token',fetchSupplierList)
AuthRouter.post('/sendorder/:contractorId',CheckAuth,SendOrderToContractor)
AuthRouter.get('/cancelorder/:orderId',CheckAuth,cancelOrder)
AuthRouter.get('/fetchorder',fetchOrders)
AuthRouter.get('/fetchselectedorder/:orderId',CheckAuth,fetchSelectedOrderDetails)
AuthRouter.post('/conversationchat/:clientId',CheckAuth,ConversetionChat)
AuthRouter.get('/fetchconversationchat/:clientId',CheckAuth,fetchConversationChat)
